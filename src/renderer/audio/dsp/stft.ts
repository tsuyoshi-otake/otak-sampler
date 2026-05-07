// Short-time Fourier transform with center=True semantics (matching librosa /
// torch.stft defaults), Hann periodic window, and overlap-add iSTFT with
// window-squared normalization.

import { ArbitraryFFT } from './fft';

export interface STFTConfig {
  nFft: number;
  hop: number;
}

export interface ComplexFrames {
  numFrames: number;
  numBins: number; // nFft / 2 + 1
  re: Float32Array; // shape [numBins, numFrames] (column-major: bin slow, frame fast)
  im: Float32Array;
}

export class STFT {
  readonly nFft: number;
  readonly hop: number;
  private readonly window: Float32Array; // periodic Hann
  private readonly fft: ArbitraryFFT;

  constructor(config: STFTConfig) {
    this.nFft = config.nFft;
    this.hop = config.hop;
    this.window = hannPeriodic(config.nFft);
    this.fft = new ArbitraryFFT(config.nFft);
  }

  // signal length L → numFrames = floor(L / hop) + 1, with reflect padding by nFft/2.
  forward(signal: Float32Array): ComplexFrames {
    const half = this.nFft >> 1;
    const padded = padReflect(signal, half);
    const numFrames = Math.floor(signal.length / this.hop) + 1;
    const numBins = half + 1;

    const re = new Float32Array(numBins * numFrames);
    const im = new Float32Array(numBins * numFrames);

    const buf = new Float32Array(this.nFft);
    const outR = new Float32Array(this.nFft);
    const outI = new Float32Array(this.nFft);

    for (let f = 0; f < numFrames; f++) {
      const start = f * this.hop;
      for (let i = 0; i < this.nFft; i++) {
        buf[i] = (padded[start + i] ?? 0) * (this.window[i] ?? 0);
      }
      this.fft.transform(buf, null, outR, outI);
      for (let k = 0; k < numBins; k++) {
        re[k * numFrames + f] = outR[k] ?? 0;
        im[k * numFrames + f] = outI[k] ?? 0;
      }
    }

    return { numFrames, numBins, re, im };
  }

  // Inverse STFT. Caller specifies the output length (typically the signal length
  // before forward). Uses overlap-add with window^2 normalization (librosa default).
  inverse(frames: ComplexFrames, length: number): Float32Array {
    const { numFrames, numBins, re, im } = frames;
    const half = this.nFft >> 1;
    const paddedLen = length + this.nFft;
    const out = new Float32Array(paddedLen);
    const norm = new Float32Array(paddedLen);

    const fullR = new Float32Array(this.nFft);
    const fullI = new Float32Array(this.nFft);
    const timeR = new Float32Array(this.nFft);
    const timeI = new Float32Array(this.nFft);
    const windowSq = new Float32Array(this.nFft);
    for (let i = 0; i < this.nFft; i++) {
      const w = this.window[i] ?? 0;
      windowSq[i] = w * w;
    }

    for (let f = 0; f < numFrames; f++) {
      // Build the full Hermitian spectrum from the half spectrum.
      for (let k = 0; k < numBins; k++) {
        fullR[k] = re[k * numFrames + f] ?? 0;
        fullI[k] = im[k * numFrames + f] ?? 0;
      }
      for (let k = numBins; k < this.nFft; k++) {
        const mirror = this.nFft - k;
        fullR[k] = re[mirror * numFrames + f] ?? 0;
        fullI[k] = -(im[mirror * numFrames + f] ?? 0);
      }
      this.fft.inverseTransform(fullR, fullI, timeR, timeI);

      const start = f * this.hop;
      for (let i = 0; i < this.nFft; i++) {
        const w = this.window[i] ?? 0;
        out[start + i] = (out[start + i] ?? 0) + (timeR[i] ?? 0) * w;
        norm[start + i] = (norm[start + i] ?? 0) + (windowSq[i] ?? 0);
      }
    }

    // Trim the leading nFft/2 samples that came from reflect padding, then
    // normalize by summed window² (librosa convention).
    const result = new Float32Array(length);
    const eps = 1e-10;
    for (let i = 0; i < length; i++) {
      const idx = i + half;
      const n = norm[idx] ?? 0;
      result[i] = n > eps ? (out[idx] ?? 0) / n : 0;
    }
    return result;
  }
}

export function hannPeriodic(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  }
  return w;
}

// librosa center=True padding: reflect padding (no edge sample duplication).
function padReflect(x: Float32Array, pad: number): Float32Array {
  const out = new Float32Array(x.length + 2 * pad);
  for (let i = 0; i < pad; i++) {
    out[i] = x[pad - i] ?? 0;
  }
  for (let i = 0; i < x.length; i++) out[pad + i] = x[i] ?? 0;
  for (let i = 0; i < pad; i++) {
    const src = x.length - 2 - i;
    out[pad + x.length + i] = x[src] ?? 0;
  }
  return out;
}
