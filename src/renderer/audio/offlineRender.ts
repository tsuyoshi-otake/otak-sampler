export interface EditOps {
  // All times in seconds, relative to the source buffer.
  trimStart: number;
  trimEnd: number;
  fadeIn: number;
  fadeOut: number;
  gainDb: number;
}

export function defaultEditOps(buffer: AudioBuffer): EditOps {
  return {
    trimStart: 0,
    trimEnd: buffer.duration,
    fadeIn: 0,
    fadeOut: 0,
    gainDb: 0
  };
}

export async function renderEdits(source: AudioBuffer, ops: EditOps): Promise<AudioBuffer> {
  const trimStart = clamp(ops.trimStart, 0, source.duration);
  const trimEnd = clamp(ops.trimEnd, trimStart, source.duration);
  const segment = Math.max(trimEnd - trimStart, 1 / source.sampleRate);

  const fadeIn = clamp(ops.fadeIn, 0, segment);
  const fadeOut = clamp(ops.fadeOut, 0, segment - fadeIn);
  const linearGain = dbToLinear(ops.gainDb);
  const frames = Math.max(1, Math.round(segment * source.sampleRate));

  const ctx = new OfflineAudioContext(source.numberOfChannels, frames, source.sampleRate);
  const node = ctx.createBufferSource();
  node.buffer = source;
  const gain = ctx.createGain();

  // Build envelope: 0 at t=0 (if fadeIn) → linearGain → linearGain → 0 at t=segment (if fadeOut).
  const epsilon = 1e-4;
  if (fadeIn > 0) {
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(linearGain, fadeIn);
  } else {
    gain.gain.setValueAtTime(linearGain, 0);
  }
  if (fadeOut > 0) {
    const holdEnd = Math.max(fadeIn, segment - fadeOut);
    gain.gain.setValueAtTime(linearGain, holdEnd);
    // Avoid ramp to exactly 0 (some implementations skip it); ramp to a tiny floor.
    gain.gain.linearRampToValueAtTime(epsilon, segment);
  }

  node.connect(gain).connect(ctx.destination);
  node.start(0, trimStart, segment);

  return ctx.startRendering();
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function clamp(value: number, lo: number, hi: number): number {
  if (Number.isNaN(value)) return lo;
  return Math.max(lo, Math.min(hi, value));
}
