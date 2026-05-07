import { STFT } from '../../src/renderer/audio/dsp/stft';

describe('STFT', () => {
  it('forward → inverse approximately recovers a real signal', () => {
    const stft = new STFT({ nFft: 64, hop: 16 });
    const N = 1024;
    const x = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      x[i] = Math.sin((i / 64) * Math.PI * 2) + 0.3 * Math.sin((i / 13) * Math.PI * 2);
    }
    const frames = stft.forward(x);
    expect(frames.numBins).toBe(33); // nFft/2 + 1
    expect(frames.numFrames).toBe(Math.floor(N / 16) + 1);

    const recovered = stft.inverse(frames, N);

    // Skip a small edge region where the reflect padding + windowing produces
    // small artifacts. Interior should match closely.
    let maxDiff = 0;
    for (let i = 64; i < N - 64; i++) {
      const d = Math.abs((recovered[i] ?? 0) - (x[i] ?? 0));
      if (d > maxDiff) maxDiff = d;
    }
    expect(maxDiff).toBeLessThan(1e-3);
  });

  it('produces the expected number of frames for hop=1024 / nFft=6144', () => {
    const stft = new STFT({ nFft: 6144, hop: 1024 });
    const x = new Float32Array(255 * 1024);
    const frames = stft.forward(x);
    expect(frames.numFrames).toBe(256);
    expect(frames.numBins).toBe(6144 / 2 + 1);
  });
});
