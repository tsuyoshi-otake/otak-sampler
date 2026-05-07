import { useEffect, useState } from 'react';
import type { UpdaterEvent } from '../../shared/ipc-contract';

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'up-to-date'; version: string }
  | { kind: 'error'; message: string };

export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const off = window.sampler.updater.onEvent((event: UpdaterEvent) => {
      if (event.kind === 'checking') setPhase({ kind: 'checking' });
      else if (event.kind === 'available') setPhase({ kind: 'available', version: event.version });
      else if (event.kind === 'progress')
        setPhase({ kind: 'downloading', percent: event.percent });
      else if (event.kind === 'downloaded') setPhase({ kind: 'ready', version: event.version });
      else if (event.kind === 'error') setPhase({ kind: 'error', message: event.message });
      else if (event.kind === 'not-available')
        setPhase({ kind: 'up-to-date', version: event.version });
      setDismissed(false);
    });
    return off;
  }, []);

  // Auto-fade the transient "checking" / "up-to-date" / "error" states so
  // the banner doesn't permanently stick when there's nothing to act on.
  useEffect(() => {
    if (phase.kind === 'up-to-date' || phase.kind === 'error') {
      const id = window.setTimeout(() => setPhase({ kind: 'idle' }), 4000);
      return () => window.clearTimeout(id);
    }
    return;
  }, [phase]);

  if (dismissed) return null;
  if (phase.kind === 'idle') return null;

  return (
    <div
      className={`px-4 py-2 border-b text-sm flex items-center justify-between ${
        phase.kind === 'error'
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
          : phase.kind === 'up-to-date'
            ? 'border-zinc-700 bg-zinc-800/60 text-zinc-300'
            : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
      }`}
    >
      <div className="flex items-center gap-3">
        {phase.kind === 'checking' && <span>Checking for updates…</span>}
        {phase.kind === 'up-to-date' && (
          <span>
            Up to date — running <span className="font-mono">v{phase.version}</span>
          </span>
        )}
        {phase.kind === 'available' && (
          <>
            <span>
              Update available — <span className="font-mono">v{phase.version}</span>
            </span>
            <button
              onClick={() => void window.sampler.updater.download()}
              className="px-2 py-0.5 rounded bg-emerald-500/30 hover:bg-emerald-500/40 text-emerald-50"
            >
              Download
            </button>
          </>
        )}
        {phase.kind === 'downloading' && (
          <span>
            Downloading update… {Math.round(phase.percent)}%
          </span>
        )}
        {phase.kind === 'ready' && (
          <>
            <span>
              Update <span className="font-mono">v{phase.version}</span> ready to install.
            </span>
            <button
              onClick={() => void window.sampler.updater.quitAndInstall()}
              className="px-2 py-0.5 rounded bg-emerald-500/30 hover:bg-emerald-500/40 text-emerald-50"
            >
              Restart and install
            </button>
          </>
        )}
        {phase.kind === 'error' && <span>Update check failed: {phase.message}</span>}
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="opacity-70 hover:opacity-100 text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
