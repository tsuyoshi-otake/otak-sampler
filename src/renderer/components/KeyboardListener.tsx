import { useEffect } from 'react';
import { useSampler } from '../state/store';
import { audioEngine } from '../audio/AudioEngine';

export function KeyboardListener(): null {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const target = document.activeElement as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
      }
      const { bank, loadedPadIds, pianoOpen } = useSampler.getState();
      if (pianoOpen) return;
      const padId = bank.keymap[e.key.toLowerCase()];
      if (padId === undefined) return;
      const pad = bank.pads[padId];
      if (!pad) return;
      e.preventDefault();
      if (loadedPadIds.has(padId)) audioEngine.play(padId, pad.gainDb);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return null;
}
