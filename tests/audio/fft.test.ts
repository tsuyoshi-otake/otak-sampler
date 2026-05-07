import { ArbitraryFFT } from '../../src/renderer/audio/dsp/fft';

// Reference O(N²) DFT for cross-checking Bluestein.
function naiveDft(re: Float32Array, im: Float32Array): { R: Float32Array; I: Float32Array } {
  const N = re.length;
  const R = new Float32Array(N);
  const I = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    let sumR = 0;
    let sumI = 0;
    for (let n = 0; n < N; n++) {
      const phi = (-2 * Math.PI * k * n) / N;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      sumR += (re[n] ?? 0) * c - (im[n] ?? 0) * s;
      sumI += (re[n] ?? 0) * s + (im[n] ?? 0) * c;
    }
    R[k] = sumR;
    I[k] = sumI;
  }
  return { R, I };
}

describe('ArbitraryFFT', () => {
  it.each([5, 6, 7, 12, 30])('matches naive DFT for size %i', (N) => {
    const fft = new ArbitraryFFT(N);
    const xr = new Float32Array(N);
    const xi = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      xr[i] = Math.sin((i / N) * Math.PI * 4) + 0.3 * (i % 3);
      xi[i] = 0.1 * Math.cos((i / N) * Math.PI * 6);
    }
    const outR = new Float32Array(N);
    const outI = new Float32Array(N);
    fft.transform(xr, xi, outR, outI);
    const ref = naiveDft(xr, xi);
    for (let k = 0; k < N; k++) {
      expect(outR[k]).toBeCloseTo(ref.R[k] ?? 0, 3);
      expect(outI[k]).toBeCloseTo(ref.I[k] ?? 0, 3);
    }
  });

  it('forward + inverse recovers the original (size 64)', () => {
    const N = 64;
    const fft = new ArbitraryFFT(N);
    const xr = new Float32Array(N);
    const xi = new Float32Array(N);
    for (let i = 0; i < N; i++) xr[i] = Math.cos((i / N) * Math.PI * 6);

    const FR = new Float32Array(N);
    const FI = new Float32Array(N);
    fft.transform(xr, xi, FR, FI);

    const recR = new Float32Array(N);
    const recI = new Float32Array(N);
    fft.inverseTransform(FR, FI, recR, recI);

    for (let i = 0; i < N; i++) {
      expect(recR[i]).toBeCloseTo(xr[i] ?? 0, 4);
      expect(recI[i]).toBeCloseTo(0, 4);
    }
  });
});
