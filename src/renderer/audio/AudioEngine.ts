import { startLoopbackRecorder, type RecorderHandle } from './recorder';

const TARGET_SAMPLE_RATE = 48000;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private active = new Map<number, Set<AudioBufferSourceNode>>();
  private buffers = new Map<number, AudioBuffer>();

  context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setBuffer(padId: number, buffer: AudioBuffer | null): void {
    if (buffer) this.buffers.set(padId, buffer);
    else this.buffers.delete(padId);
  }

  getBuffer(padId: number): AudioBuffer | undefined {
    return this.buffers.get(padId);
  }

  play(padId: number, gainDb = 0): void {
    const buf = this.buffers.get(padId);
    if (!buf) return;
    const ctx = this.context();
    const source = ctx.createBufferSource();
    source.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = Math.pow(10, gainDb / 20);
    source.connect(gain).connect(ctx.destination);

    let set = this.active.get(padId);
    if (!set) {
      set = new Set();
      this.active.set(padId, set);
    }
    set.add(source);
    source.onended = () => {
      set?.delete(source);
    };
    source.start();
  }

  stop(padId: number): void {
    const set = this.active.get(padId);
    if (!set) return;
    for (const node of set) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    }
    set.clear();
  }

  stopAll(): void {
    for (const padId of this.active.keys()) this.stop(padId);
  }

  async record(): Promise<RecorderHandle> {
    return startLoopbackRecorder(this.context());
  }

  async decode(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    return this.context().decodeAudioData(arrayBuffer);
  }
}

export const audioEngine = new AudioEngine();
