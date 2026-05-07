// Resample any AudioBuffer to a target sample rate via OfflineAudioContext.
// Browser/Chromium use a high-quality resampler (sinc-based), so we get good
// quality without bringing in a separate WASM dep.

export async function resampleBuffer(
  source: AudioBuffer,
  targetRate: number
): Promise<AudioBuffer> {
  if (source.sampleRate === targetRate) return source;
  const targetFrames = Math.ceil((source.length * targetRate) / source.sampleRate);
  const ctx = new OfflineAudioContext(source.numberOfChannels, targetFrames, targetRate);
  const node = ctx.createBufferSource();
  node.buffer = source;
  node.connect(ctx.destination);
  node.start(0);
  return ctx.startRendering();
}

// Build a stereo AudioBuffer from two Float32Arrays at a given sample rate.
export function buildStereoBuffer(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  audioContext: BaseAudioContext
): AudioBuffer {
  const length = Math.min(left.length, right.length);
  const buf = audioContext.createBuffer(2, length, sampleRate);
  const tmpL = new Float32Array(length);
  const tmpR = new Float32Array(length);
  tmpL.set(left.subarray(0, length));
  tmpR.set(right.subarray(0, length));
  buf.copyToChannel(tmpL, 0);
  buf.copyToChannel(tmpR, 1);
  return buf;
}
