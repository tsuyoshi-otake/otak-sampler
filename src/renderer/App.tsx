import { useEffect, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { PadGrid } from './components/PadGrid';
import { KeyboardListener } from './components/KeyboardListener';
import { WaveformEditor } from './components/WaveformEditor';
import { ChopMode } from './components/ChopMode';
import { hydrateBank } from './state/hydrate';

export function App() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const bank = await window.sampler.bank.read();
        if (cancelled) return;
        await hydrateBank(bank);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full flex flex-col">
      <Toolbar />
      <main className="flex-1 overflow-auto p-6">
        {hydrated ? <PadGrid /> : <div className="text-zinc-500">Loading…</div>}
      </main>
      <KeyboardListener />
      <WaveformEditor />
      <ChopMode />
    </div>
  );
}
