// MDX-Net (UVR-MDX-NET-Voc_FT) inference pipeline running in the renderer via
// onnxruntime-web. The model predicts the vocal spectrogram directly; the
// instrumental is recovered by sample-aligned subtraction from the original mix.

import * as ort from 'onnxruntime-web/wasm';
import { STFT, type ComplexFrames } from './stft';
import { resampleBuffer } from './resample';
import type { ModelKey } from '../../../shared/ipc-contract';

// Model constants — these are fixed by the UVR-MDX-NET-Voc_FT export.
const MODEL_SAMPLE_RATE = 44100;
const N_FFT = 6144;
const HOP = 1024;
const DIM_F = 3072;
const DIM_T = 256;
const N_BINS = N_FFT / 2 + 1; // 3073
const TRIM = N_FFT / 2; // 3072
const CHUNK = (DIM_T - 1) * HOP; // 261120 samples
const GEN = CHUNK - 2 * TRIM; // 254976 valid samples per chunk
const COMPENSATE = 1.009; // model_data.json compensate for Voc_FT

export interface SeparationResult {
  vocals: AudioBuffer;
  instrumental: AudioBuffer;
}

export type SeparationProgress =
  | { phase: 'download'; received: number; total: number }
  | { phase: 'load' }
  | { phase: 'process'; chunk: number; total: number };

let stftCache: STFT | null = null;
function getStft(): STFT {
  if (!stftCache) stftCache = new STFT({ nFft: N_FFT, hop: HOP });
  return stftCache;
}

let session: ort.InferenceSession | null = null;
let inputName: string | null = null;
let outputName: string | null = null;

export async function ensureSession(
  modelKey: ModelKey,
  onProgress?: (p: SeparationProgress) => void
): Promise<void> {
  if (session) return;
  const off = window.sampler.models.onProgress(({ received, total }) => {
    onProgress?.({ phase: 'download', received, total });
  });
  try {
    const bytes = await window.sampler.models.ensure(modelKey);
    onProgress?.({ phase: 'load' });

    ort.env.wasm.proxy = true;
    ort.env.wasm.wasmPaths = new URL('./ort/', document.baseURI).href;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;

    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm']
    });
    inputName = session.inputNames[0] ?? null;
    outputName = session.outputNames[0] ?? null;
    if (!inputName || !outputName) throw new Error('Model has no I/O bindings');
  } finally {
    off();
  }
}

export async function separateVocals(
  mix: AudioBuffer,
  audioContext: BaseAudioContext,
  onProgress?: (p: SeparationProgress) => void
): Promise<SeparationResult> {
  if (!session || !inputName || !outputName) {
    throw new Error('Vocal separation session is not ready');
  }

  // 1. Resample to model rate.
  const at44 = await resampleBuffer(mix, MODEL_SAMPLE_RATE);
  const L = at44.getChannelData(0);
  const R = at44.numberOfChannels > 1 ? at44.getChannelData(1) : L;
  const origLen = at44.length;

  // 2. Zero-pad: TRIM on each side, plus enough on the right so the run aligns with GEN.
  const numChunks = Math.max(1, Math.ceil(origLen / GEN));
  const padTotal = TRIM + numChunks * GEN + TRIM;
  const padL = new Float32Array(padTotal);
  const padR = new Float32Array(padTotal);
  padL.set(L, TRIM);
  padR.set(R, TRIM);

  // 3. Output (vocals) accumulator.
  const outL = new Float32Array(numChunks * GEN);
  const outR = new Float32Array(numChunks * GEN);

  const stft = getStft();
  const tensorSize = 4 * DIM_F * DIM_T;

  for (let i = 0; i < numChunks; i++) {
    onProgress?.({ phase: 'process', chunk: i, total: numChunks });

    const start = i * GEN;
    const chunkL = padL.subarray(start, start + CHUNK);
    const chunkR = padR.subarray(start, start + CHUNK);

    const fL = stft.forward(chunkL);
    const fR = stft.forward(chunkR);

    // Pack [1, 4, DIM_F, DIM_T] in C order with T contiguous.
    const tensorData = new Float32Array(tensorSize);
    packChannel(tensorData, 0, fL.re, fL.numFrames);
    packChannel(tensorData, 1, fL.im, fL.numFrames);
    packChannel(tensorData, 2, fR.re, fR.numFrames);
    packChannel(tensorData, 3, fR.im, fR.numFrames);

    const input = new ort.Tensor('float32', tensorData, [1, 4, DIM_F, DIM_T]);
    const result = await session.run({ [inputName]: input });
    const out = result[outputName];
    if (!out) throw new Error('Inference output missing');
    const outputData = out.data as Float32Array;

    // Unpack to per-channel complex frame buffers (full N_BINS, padding the
    // unpredicted high bins with zeros).
    const fLOutRe = new Float32Array(N_BINS * DIM_T);
    const fLOutIm = new Float32Array(N_BINS * DIM_T);
    const fROutRe = new Float32Array(N_BINS * DIM_T);
    const fROutIm = new Float32Array(N_BINS * DIM_T);
    unpackChannel(outputData, 0, fLOutRe);
    unpackChannel(outputData, 1, fLOutIm);
    unpackChannel(outputData, 2, fROutRe);
    unpackChannel(outputData, 3, fROutIm);

    const recL = stft.inverse(
      { numFrames: DIM_T, numBins: N_BINS, re: fLOutRe, im: fLOutIm },
      CHUNK
    );
    const recR = stft.inverse(
      { numFrames: DIM_T, numBins: N_BINS, re: fROutRe, im: fROutIm },
      CHUNK
    );

    // Drop TRIM samples from each side; keep GEN valid samples.
    outL.set(recL.subarray(TRIM, TRIM + GEN), i * GEN);
    outR.set(recR.subarray(TRIM, TRIM + GEN), i * GEN);
  }

  // 4. Truncate to original length and assemble vocals AudioBuffer at 44.1k.
  const vocL = outL.subarray(0, origLen);
  const vocR = outR.subarray(0, origLen);

  const vocals44 = audioContext.createBuffer(2, origLen, MODEL_SAMPLE_RATE);
  vocals44.copyToChannel(vocL, 0);
  vocals44.copyToChannel(vocR, 1);

  // 5. Instrumental = mix - vocals.
  const instL = new Float32Array(origLen);
  const instR = new Float32Array(origLen);
  for (let i = 0; i < origLen; i++) {
    instL[i] = (L[i] ?? 0) - (vocL[i] ?? 0);
    instR[i] = (R[i] ?? 0) - (vocR[i] ?? 0);
  }
  const instrumental44 = audioContext.createBuffer(2, origLen, MODEL_SAMPLE_RATE);
  instrumental44.copyToChannel(instL, 0);
  instrumental44.copyToChannel(instR, 1);

  // 6. Resample back to the source rate.
  const [vocals, instrumental] = await Promise.all([
    resampleBuffer(vocals44, mix.sampleRate),
    resampleBuffer(instrumental44, mix.sampleRate)
  ]);

  return { vocals, instrumental };
}

function packChannel(
  dst: Float32Array,
  channel: number,
  src: Float32Array,
  numFrames: number
): void {
  // src is laid out [bin][frame] with size N_BINS * numFrames; we copy the first DIM_F bins.
  const base = channel * DIM_F * DIM_T;
  for (let k = 0; k < DIM_F; k++) {
    const srcRow = k * numFrames;
    const dstRow = base + k * DIM_T;
    for (let f = 0; f < DIM_T; f++) {
      dst[dstRow + f] = src[srcRow + f] ?? 0;
    }
  }
}

function unpackChannel(src: Float32Array, channel: number, dst: Float32Array): void {
  const base = channel * DIM_F * DIM_T;
  for (let k = 0; k < DIM_F; k++) {
    const srcRow = base + k * DIM_T;
    const dstRow = k * DIM_T;
    for (let f = 0; f < DIM_T; f++) {
      dst[dstRow + f] = (src[srcRow + f] ?? 0) * COMPENSATE;
    }
  }
}

// Re-export type for upstream.
export type { ComplexFrames };
