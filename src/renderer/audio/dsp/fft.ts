// Arbitrary-size complex DFT via Bluestein's chirp-z algorithm, layered on top
// of fft.js (which only supports power-of-two sizes). Used for the STFT pipeline
// where the model's required n_fft = 6144 is not a power of 2.
//
// Bluestein:
//   X[k] = w[k] * conv(a, b)[k],  k = 0..N-1
//   where w[n] = exp(-i π n² / N), a[n] = x[n] * w[n], b[m] = w*[m].
// The convolution is computed as IFFT(FFT(a_pad) * FFT(b_pad)) at length M,
// the smallest power of 2 ≥ 2N - 1.

import FFT from 'fft.js';

export class ArbitraryFFT {
  readonly size: number;
  private readonly m: number;
  private readonly fft: FFT;
  // Pre-padded length-M complex arrays, interleaved [re0, im0, re1, im1, ...].
  private readonly bFreq: number[]; // FFT(b_pad)
  private readonly chirpRe: Float32Array; // w[n] real, length N
  private readonly chirpIm: Float32Array; // w[n] imag, length N

  constructor(size: number) {
    this.size = size;
    let m = 1;
    while (m < 2 * size - 1) m *= 2;
    this.m = m;
    this.fft = new FFT(m);

    this.chirpRe = new Float32Array(size);
    this.chirpIm = new Float32Array(size);
    for (let n = 0; n < size; n++) {
      const phi = -Math.PI * ((n * n) % (2 * size)) / size;
      this.chirpRe[n] = Math.cos(phi);
      this.chirpIm[n] = Math.sin(phi);
    }

    // b[m] = w*[m] = exp(+i π m² / N), defined for m = -(N-1) .. N-1.
    // We pack into circular length-M: b_circ[m] = b[m] for m in [0, N),
    // b_circ[M - m] = b[-m] = b[m] (b is even since (-m)² = m²) for m in [1, N).
    const bPad = new Array<number>(m * 2).fill(0);
    bPad[0] = 1;
    bPad[1] = 0;
    for (let n = 1; n < size; n++) {
      const phi = Math.PI * ((n * n) % (2 * size)) / size;
      const re = Math.cos(phi);
      const im = Math.sin(phi);
      bPad[2 * n] = re;
      bPad[2 * n + 1] = im;
      bPad[2 * (m - n)] = re;
      bPad[2 * (m - n) + 1] = im;
    }
    const bFreq = this.fft.createComplexArray();
    this.fft.transform(bFreq, bPad);
    this.bFreq = bFreq;
  }

  // Forward DFT. xRe / xIm length must equal this.size. outRe / outIm receive length size.
  transform(
    xRe: Float32Array,
    xIm: Float32Array | null,
    outRe: Float32Array,
    outIm: Float32Array
  ): void {
    const n = this.size;
    const m = this.m;

    const aPad = new Array<number>(m * 2).fill(0);
    if (xIm) {
      for (let i = 0; i < n; i++) {
        const xr = xRe[i] ?? 0;
        const xi = xIm[i] ?? 0;
        const wr = this.chirpRe[i] ?? 0;
        const wi = this.chirpIm[i] ?? 0;
        aPad[2 * i] = xr * wr - xi * wi;
        aPad[2 * i + 1] = xr * wi + xi * wr;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const xr = xRe[i] ?? 0;
        const wr = this.chirpRe[i] ?? 0;
        const wi = this.chirpIm[i] ?? 0;
        aPad[2 * i] = xr * wr;
        aPad[2 * i + 1] = xr * wi;
      }
    }

    const aFreq = this.fft.createComplexArray();
    this.fft.transform(aFreq, aPad);

    // Pointwise multiply aFreq * bFreq.
    for (let i = 0; i < m; i++) {
      const ar = aFreq[2 * i] ?? 0;
      const ai = aFreq[2 * i + 1] ?? 0;
      const br = this.bFreq[2 * i] ?? 0;
      const bi = this.bFreq[2 * i + 1] ?? 0;
      aFreq[2 * i] = ar * br - ai * bi;
      aFreq[2 * i + 1] = ar * bi + ai * br;
    }

    const conv = this.fft.createComplexArray();
    this.fft.inverseTransform(conv, aFreq);
    // fft.js inverseTransform already includes the 1/M normalization.

    for (let k = 0; k < n; k++) {
      const cr = conv[2 * k] ?? 0;
      const ci = conv[2 * k + 1] ?? 0;
      const wr = this.chirpRe[k] ?? 0;
      const wi = this.chirpIm[k] ?? 0;
      outRe[k] = cr * wr - ci * wi;
      outIm[k] = cr * wi + ci * wr;
    }

    // Suppress unused warning if m isn't referenced later.
    void m;
  }

  // Inverse DFT via conjugation trick: IDFT(X) = conj(DFT(conj(X))) / N.
  inverseTransform(
    xRe: Float32Array,
    xIm: Float32Array,
    outRe: Float32Array,
    outIm: Float32Array
  ): void {
    const n = this.size;
    const conjIm = new Float32Array(n);
    for (let i = 0; i < n; i++) conjIm[i] = -(xIm[i] ?? 0);
    this.transform(xRe, conjIm, outRe, outIm);
    const inv = 1 / n;
    for (let i = 0; i < n; i++) {
      outRe[i] = (outRe[i] ?? 0) * inv;
      outIm[i] = -(outIm[i] ?? 0) * inv;
    }
  }
}
