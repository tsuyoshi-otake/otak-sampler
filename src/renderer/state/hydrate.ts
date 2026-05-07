import { audioEngine } from '../audio/AudioEngine';
import { useSampler } from './store';
import type { BankFile } from '../../shared/bank-schema';

export async function hydrateBank(bank: BankFile): Promise<void> {
  const {
    setBank,
    markPadLoaded,
    markPadUnloaded,
    markLoopLoaded,
    markLoopUnloaded,
    markLoopStopped
  } = useSampler.getState();

  const prev = useSampler.getState().bank;
  for (const pad of prev.pads) {
    audioEngine.stop(pad.id);
    audioEngine.setBuffer(pad.id, null);
    markPadUnloaded(pad.id);
  }
  for (const slot of prev.loopers) {
    audioEngine.stopLoop(slot.id);
    audioEngine.setLoopBuffer(slot.id, null);
    markLoopUnloaded(slot.id);
    markLoopStopped(slot.id);
  }

  setBank(bank);

  await Promise.all([
    ...bank.pads.map(async (pad) => {
      if (!pad.samplePath) return;
      try {
        const arr = await window.sampler.samples.load({ path: pad.samplePath });
        const buffer = await audioEngine.decode(arr);
        audioEngine.setBuffer(pad.id, buffer);
        markPadLoaded(pad.id);
      } catch (err) {
        console.warn(`Failed to load sample for pad ${pad.id}`, err);
      }
    }),
    ...bank.loopers.map(async (slot) => {
      if (!slot.samplePath) return;
      try {
        const arr = await window.sampler.samples.load({ path: slot.samplePath });
        const buffer = await audioEngine.decode(arr);
        audioEngine.setLoopBuffer(slot.id, buffer);
        markLoopLoaded(slot.id);
      } catch (err) {
        console.warn(`Failed to load loop for slot ${slot.id}`, err);
      }
    })
  ]);
}

export async function hydrateSettings(): Promise<void> {
  try {
    const settings = await window.sampler.settings.read();
    useSampler.getState().setSettings(settings);
    // Stage device IDs onto the engine. Apply is deferred until the first
    // user gesture (pad play, record, or device-menu interaction) to avoid
    // autoplay-policy rejections.
    audioEngine.setPrimaryOutput(settings.primaryOutputDeviceId);
    audioEngine.setMonitorOutput(settings.monitorOutputDeviceId);
  } catch (err) {
    console.warn('Failed to hydrate settings', err);
  }
}
