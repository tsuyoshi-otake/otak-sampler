import { useEffect, useRef } from 'react';
import type { PadConfig } from '../../shared/bank-schema';
import { audioEngine } from '../audio/AudioEngine';
import { useSampler } from '../state/store';

interface Props {
  pad: PadConfig;
  selected: boolean;
  loaded: boolean;
}

export function Pad({ pad, selected, loaded }: Props) {
  const selectPad = useSampler((s) => s.selectPad);
  const openEditor = useSampler((s) => s.openEditor);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const buffer = loaded ? audioEngine.getBuffer(pad.id) : undefined;
    drawWaveform(ctx, canvas.width, canvas.height, buffer);
  }, [loaded, pad.id, pad.samplePath]);

  const onClick = (): void => {
    selectPad(pad.id);
    if (loaded) audioEngine.play(pad.id, pad.gainDb);
  };

  const onDoubleClick = (): void => {
    if (loaded) openEditor(pad.id);
  };

  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`relative aspect-square rounded-xl border-2 transition-colors text-left p-3 flex flex-col justify-between ${
        selected
          ? 'border-emerald-400 bg-zinc-800'
          : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600'
      } ${loaded ? '' : 'opacity-70'}`}
    >
      <div className="flex justify-between items-start">
        <span className="text-xs font-semibold text-zinc-400">{pad.name}</span>
        <kbd className="text-[10px] font-mono bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300">
          {pad.key.toUpperCase() || '·'}
        </kbd>
      </div>
      <canvas
        ref={canvasRef}
        width={160}
        height={36}
        className="w-full h-9 opacity-90"
      />
      <span className="text-[10px] text-zinc-500">
        {loaded ? 'loaded' : 'empty'}
      </span>
    </button>
  );
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  buffer: AudioBuffer | undefined
): void {
  ctx.clearRect(0, 0, width, height);
  if (!buffer) {
    ctx.strokeStyle = '#3f3f46';
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    return;
  }
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / width));
  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    let min = 1;
    let max = -1;
    const start = x * step;
    const end = Math.min(start + step, data.length);
    for (let i = start; i < end; i++) {
      const v = data[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const yMin = ((1 - min) / 2) * height;
    const yMax = ((1 - max) / 2) * height;
    ctx.moveTo(x + 0.5, yMin);
    ctx.lineTo(x + 0.5, yMax);
  }
  ctx.stroke();
}
