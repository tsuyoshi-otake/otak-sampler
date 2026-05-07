declare module 'fft.js' {
  export default class FFT {
    constructor(size: number);
    readonly size: number;
    createComplexArray(): number[];
    transform(out: number[], data: number[]): void;
    inverseTransform(out: number[], data: number[]): void;
    realTransform(out: number[], data: number[]): void;
    completeSpectrum(out: number[]): void;
    toComplexArray(input: number[] | Float32Array, storage?: number[]): number[];
    fromComplexArray(complex: number[], storage?: Float32Array): Float32Array;
  }
}
