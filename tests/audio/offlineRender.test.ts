/**
 * @jest-environment jsdom
 */
import { renderEdits } from '../../src/renderer/audio/offlineRender';

// Inline minimal AudioBuffer / OfflineAudioContext stubs.
// renderEdits exercises:
//   - new OfflineAudioContext(channels, frames, sampleRate)
//   - createBufferSource(), createGain(), connect(), start(), startRendering()
//   - GainParam: setValueAtTime, linearRampToValueAtTime
// We only need the constructor to capture the requested length so the test
// can assert renderEdits computed the right trim window.

interface FakeOfflineCtx {
  length: number;
  sampleRate: number;
  numberOfChannels: number;
  destination: object;
  createBufferSource: () => {
    buffer: AudioBuffer | null;
    connect: (n: object) => object;
    start: () => void;
  };
  createGain: () => { gain: { setValueAtTime: () => void; linearRampToValueAtTime: () => void }; connect: (n: object) => object };
  startRendering: () => Promise<AudioBuffer>;
}

class FakeOfflineAudioContext implements FakeOfflineCtx {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  destination = {};
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
  }
  createBufferSource() {
    return {
      buffer: null as AudioBuffer | null,
      connect: (n: object) => n,
      start: () => undefined
    };
  }
  createGain() {
    return {
      gain: {
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined
      },
      connect: (n: object) => n
    };
  }
  startRendering(): Promise<AudioBuffer> {
    return Promise.resolve({
      length: this.length,
      duration: this.length / this.sampleRate,
      numberOfChannels: this.numberOfChannels,
      sampleRate: this.sampleRate,
      getChannelData: () => new Float32Array(this.length),
      copyFromChannel: () => undefined,
      copyToChannel: () => undefined
    } as unknown as AudioBuffer);
  }
}

beforeAll(() => {
  (globalThis as unknown as { OfflineAudioContext: typeof FakeOfflineAudioContext }).OfflineAudioContext =
    FakeOfflineAudioContext;
});

function makeBuffer(channels: number, frames: number, sampleRate: number): AudioBuffer {
  const data: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(frames).fill(1));
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
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined
  } as unknown as AudioBuffer;
}

describe('renderEdits', () => {
  it('produces an output whose length matches the trim window', async () => {
    const sr = 48000;
    const src = makeBuffer(1, sr, sr); // 1 second
    const out = await renderEdits(src, {
      trimStart: 0.25,
      trimEnd: 0.75,
      fadeIn: 0,
      fadeOut: 0,
      gainDb: 0
    });
    expect(out.length).toBe(Math.round(0.5 * sr));
    expect(out.sampleRate).toBe(sr);
  });

  it('clamps trim window to source duration', async () => {
    const sr = 48000;
    const src = makeBuffer(1, sr / 2, sr); // 0.5 second
    const out = await renderEdits(src, {
      trimStart: -1,
      trimEnd: 5,
      fadeIn: 0,
      fadeOut: 0,
      gainDb: 0
    });
    expect(out.length).toBe(Math.round(0.5 * sr));
  });

  it('preserves channel count', async () => {
    const sr = 48000;
    const src = makeBuffer(2, sr, sr);
    const out = await renderEdits(src, {
      trimStart: 0,
      trimEnd: 1,
      fadeIn: 0.1,
      fadeOut: 0.1,
      gainDb: -6
    });
    expect(out.numberOfChannels).toBe(2);
  });
});
