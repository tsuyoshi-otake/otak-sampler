import { useState } from 'react';
import { useSampler } from '../state/store';
import { audioEngine } from '../audio/AudioEngine';
import { LooperSlot } from './LooperSlot';

export function LooperPanel() {
  const loopers = useSampler((s) => s.bank.loopers);
  const playing = useSampler((s) => s.loopPlaying);
  const [open, setOpen] = useState(true);

  const stopAllLoops = (): void => {
    audioEngine.stopAllLoops();
    const { markLoopStopped } = useSampler.getState();
    for (const slotId of playing) markLoopStopped(slotId);
  };

  return (
    <section className="border-t border-zinc-800 bg-zinc-950/80">
      <header className="flex items-center justify-between px-4 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-sm text-zinc-300 hover:text-zinc-100"
        >
          <span className="font-mono uppercase tracking-wider text-xs text-zinc-500">Looper</span>
          <span className="text-[10px] text-zinc-500">
            {playing.size > 0 ? `${playing.size} playing` : 'idle'}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <button
          onClick={stopAllLoops}
          disabled={playing.size === 0}
          className="px-2 py-1 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Stop loops
        </button>
      </header>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-4 gap-3">
          {loopers.map((slot) => (
            <LooperSlot key={slot.id} slot={slot} />
          ))}
        </div>
      )}
    </section>
  );
}
