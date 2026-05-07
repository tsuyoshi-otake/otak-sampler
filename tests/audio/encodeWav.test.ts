import { encodeWav } from '../../src/renderer/audio/encodeWav';

function makeBuffer(channels: number, frames: number, sampleRate: number): AudioBuffer {
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const arr = new Float32Array(frames);
    for (let i = 0; i < frames; i++) arr[i] = Math.sin((i / frames) * Math.PI * 2) * 0.5;
    data.push(arr);
  }
  return {
    duration: frames / sampleRate,
    length: frames,
    numberOfChannels: channels,
    sampleRate,
    getChannelData: (c: number): Float32Array => {
      const ch = data[c];
      if (!ch) throw new Error(`channel ${c} out of range`);
      return ch;
    },
    copyFromChannel: (): void => undefined,
    copyToChannel: (): void => undefined
  } as unknown as AudioBuffer;
}

describe('encodeWav', () => {
  it('writes a valid 16-bit PCM WAV header for stereo', () => {
    const sr = 48000;
    const frames = 4800;
    const buf = makeBuffer(2, frames, sr);
    const out = encodeWav(buf);
    const view = new DataView(out);

    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF');
    expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(sr);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(frames * 2 * 2); // dataSize
    expect(out.byteLength).toBe(44 + frames * 2 * 2);
  });

  it('clamps sample values to [-1, 1]', () => {
    const sr = 8000;
    const frames = 4;
    const ch = new Float32Array([2, -2, 0.5, -0.5]);
    const buf = {
      duration: frames / sr,
      length: frames,
      numberOfChannels: 1,
      sampleRate: sr,
      getChannelData: () => ch
    } as unknown as AudioBuffer;
    const out = encodeWav(buf);
    const view = new DataView(out);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});
