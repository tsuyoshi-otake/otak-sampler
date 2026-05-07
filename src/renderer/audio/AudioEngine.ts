import { startRecorder, type RecorderHandle, type RecordingSource } from './recorder';

const TARGET_SAMPLE_RATE = 48000;

export type DeviceErrorChannel = 'primary' | 'monitor';

export interface DeviceError {
  channel: DeviceErrorChannel;
  message: string;
}

type DeviceErrorListener = (err: DeviceError | null) => void;

// AudioContext.setSinkId is shipping in Chromium 110+ (Electron 32 has it),
// but lib.dom.d.ts in TS 5.6 has not added it yet.
type SinkCapableContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private monitorDest: MediaStreamAudioDestinationNode | null = null;
  private monitorAudioEl: HTMLAudioElement | null = null;
  private active = new Map<number, Set<AudioBufferSourceNode>>();
  private buffers = new Map<number, AudioBuffer>();
  private loopBuffers = new Map<number, AudioBuffer>();
  private loopActive = new Map<number, Set<AudioBufferSourceNode>>();

  private desiredPrimary: string | null = null;
  private desiredMonitor: string | null = null;
  private appliedPrimary: string | null | undefined = undefined;
  private appliedMonitor: string | null | undefined = undefined;
  private gestureUnlocked = false;

  private deviceError: DeviceError | null = null;
  private deviceErrorListeners = new Set<DeviceErrorListener>();

  context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
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
    source.connect(gain).connect(this.masterGain ?? ctx.destination);

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

    // Treat playback as a user gesture so any deferred sink switch can land.
    this.armUserGesture();
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
    this.stopAllLoops();
  }

  setLoopBuffer(slotId: number, buffer: AudioBuffer | null): void {
    if (buffer) this.loopBuffers.set(slotId, buffer);
    else this.loopBuffers.delete(slotId);
  }

  getLoopBuffer(slotId: number): AudioBuffer | undefined {
    return this.loopBuffers.get(slotId);
  }

  playLoop(slotId: number, gainDb = 0): void {
    const buf = this.loopBuffers.get(slotId);
    if (!buf) return;
    // Stop any node already running for this slot so calling play() twice
    // restarts cleanly instead of layering identical loops on top of itself.
    this.stopLoop(slotId);
    const ctx = this.context();
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = Math.pow(10, gainDb / 20);
    source.connect(gain).connect(this.masterGain ?? ctx.destination);

    let set = this.loopActive.get(slotId);
    if (!set) {
      set = new Set();
      this.loopActive.set(slotId, set);
    }
    set.add(source);
    source.onended = () => {
      set?.delete(source);
    };
    source.start(0);
    this.armUserGesture();
  }

  stopLoop(slotId: number): void {
    const set = this.loopActive.get(slotId);
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

  stopAllLoops(): void {
    for (const slotId of this.loopActive.keys()) this.stopLoop(slotId);
  }

  isLoopPlaying(slotId: number): boolean {
    const set = this.loopActive.get(slotId);
    return !!set && set.size > 0;
  }

  playNote(
    padId: number,
    semitones: number,
    gainDb = 0
  ): { stop: () => void } {
    const buf = this.buffers.get(padId);
    if (!buf) return { stop: () => {} };
    const ctx = this.context();
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.playbackRate.value = Math.pow(2, semitones / 12);
    const gain = ctx.createGain();
    gain.gain.value = Math.pow(10, gainDb / 20);
    source.connect(gain).connect(this.masterGain ?? ctx.destination);
    source.start(0);
    this.armUserGesture();
    let stopped = false;
    return {
      stop: () => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        // Short release to avoid clicks when keys are released.
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.03);
        try {
          source.stop(now + 0.04);
        } catch {
          /* already stopped */
        }
      }
    };
  }

  async record(source: RecordingSource = 'loopback'): Promise<RecorderHandle> {
    this.armUserGesture();
    return startRecorder(this.context(), source);
  }

  async decode(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    return this.context().decodeAudioData(arrayBuffer);
  }

  setPrimaryOutput(deviceId: string | null): void {
    this.desiredPrimary = deviceId;
    void this.flushDesired();
  }

  setMonitorOutput(deviceId: string | null): void {
    this.desiredMonitor = deviceId;
    void this.flushDesired();
  }

  armUserGesture(): void {
    if (this.gestureUnlocked) return;
    this.gestureUnlocked = true;
    void this.flushDesired();
  }

  getDeviceError(): DeviceError | null {
    return this.deviceError;
  }

  onDeviceError(listener: DeviceErrorListener): () => void {
    this.deviceErrorListeners.add(listener);
    return () => this.deviceErrorListeners.delete(listener);
  }

  private emitDeviceError(err: DeviceError | null): void {
    this.deviceError = err;
    for (const listener of this.deviceErrorListeners) listener(err);
  }

  private async flushDesired(): Promise<void> {
    if (!this.ctx || !this.masterGain) return;
    if (!this.gestureUnlocked) return;

    if (this.appliedPrimary !== this.desiredPrimary) {
      const ctx = this.ctx as SinkCapableContext;
      if (typeof ctx.setSinkId === 'function') {
        try {
          await ctx.setSinkId(this.desiredPrimary ?? '');
          this.appliedPrimary = this.desiredPrimary;
          if (this.deviceError?.channel === 'primary') this.emitDeviceError(null);
        } catch (err) {
          this.emitDeviceError({
            channel: 'primary',
            message: err instanceof Error ? err.message : String(err)
          });
        }
      } else {
        this.appliedPrimary = this.desiredPrimary;
      }
    }

    if (this.appliedMonitor !== this.desiredMonitor) {
      try {
        await this.applyMonitor(this.desiredMonitor);
        this.appliedMonitor = this.desiredMonitor;
        if (this.deviceError?.channel === 'monitor') this.emitDeviceError(null);
      } catch (err) {
        this.emitDeviceError({
          channel: 'monitor',
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }

  private async applyMonitor(deviceId: string | null): Promise<void> {
    if (!this.ctx || !this.masterGain) return;

    if (!deviceId) {
      if (this.monitorDest) {
        try {
          this.masterGain.disconnect(this.monitorDest);
        } catch {
          /* not connected */
        }
        this.monitorDest = null;
      }
      if (this.monitorAudioEl) {
        this.monitorAudioEl.pause();
        this.monitorAudioEl.srcObject = null;
        this.monitorAudioEl.remove();
        this.monitorAudioEl = null;
      }
      return;
    }

    if (!this.monitorDest) {
      this.monitorDest = this.ctx.createMediaStreamDestination();
      this.masterGain.connect(this.monitorDest);
    }
    if (!this.monitorAudioEl) {
      const el = document.createElement('audio');
      el.style.display = 'none';
      el.autoplay = true;
      el.srcObject = this.monitorDest.stream;
      document.body.appendChild(el);
      this.monitorAudioEl = el;
    }
    await this.monitorAudioEl.setSinkId(deviceId);
    await this.monitorAudioEl.play();
  }
}

export const audioEngine = new AudioEngine();
