import { audioEngine } from '../audio/AudioEngine';
import { useSampler } from './store';
import type { BankFile } from '../../shared/bank-schema';

// Replace the in-memory bank with the given one and load all referenced samples
// into the AudioEngine. Pads without samplePath remain empty.
export async function hydrateBank(bank: BankFile): Promise<void> {
  const { setBank, markPadLoaded, markPadUnloaded } = useSampler.getState();

  // Reset existing buffers / loaded flags first.
  for (const pad of useSampler.getState().bank.pads) {
    audioEngine.stop(pad.id);
    audioEngine.setBuffer(pad.id, null);
    markPadUnloaded(pad.id);
  }

  setBank(bank);

  await Promise.all(
    bank.pads.map(async (pad) => {
      if (!pad.samplePath) return;
      try {
        const arr = await window.sampler.samples.load({ path: pad.samplePath });
        const buffer = await audioEngine.decode(arr);
        audioEngine.setBuffer(pad.id, buffer);
        markPadLoaded(pad.id);
      } catch (err) {
        console.warn(`Failed to load sample for pad ${pad.id}`, err);
      }
    })
  );
}
