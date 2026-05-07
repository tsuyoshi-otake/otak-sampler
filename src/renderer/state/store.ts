import { create } from 'zustand';
import {
  defaultBank,
  type BankFile,
  type PadConfig,
  type LooperSlotConfig
} from '../../shared/bank-schema';
import {
  defaultSettings,
  type SettingsFile,
  type RecordingSource
} from '../../shared/settings-schema';
import type { RecordingPhase } from './types';
import { audioEngine, type DeviceError } from '../audio/AudioEngine';

interface SamplerState {
  bank: BankFile;
  recording: RecordingPhase;
  editingPadId: number | null;
  chopOpen: boolean;
  pianoOpen: boolean;
  loadedPadIds: Set<number>;
  loopPlaying: Set<number>;
  loopLoadedSlotIds: Set<number>;
  looperRecordingSlot: number | null;
  settings: SettingsFile;
  deviceError: DeviceError | null;

  setBank: (bank: BankFile) => void;
  selectPad: (padId: number) => void;
  updatePad: (padId: number, patch: Partial<PadConfig>) => void;
  updateLooper: (slotId: number, patch: Partial<LooperSlotConfig>) => void;
  setRecording: (phase: RecordingPhase) => void;
  openEditor: (padId: number) => void;
  closeEditor: (savedPadId?: number) => void;
  openChop: () => void;
  closeChop: () => void;
  openPiano: () => void;
  closePiano: () => void;
  markPadLoaded: (padId: number) => void;
  markPadUnloaded: (padId: number) => void;
  markLoopLoaded: (slotId: number) => void;
  markLoopUnloaded: (slotId: number) => void;
  markLoopPlaying: (slotId: number) => void;
  markLoopStopped: (slotId: number) => void;
  setLooperRecordingSlot: (slotId: number | null) => void;
  setSettings: (settings: SettingsFile) => void;
  setPrimaryOutputDeviceId: (id: string | null) => Promise<void>;
  setMonitorOutputDeviceId: (id: string | null) => Promise<void>;
  setRecordingSource: (source: RecordingSource) => Promise<void>;
  setDeviceError: (err: DeviceError | null) => void;
}

async function persistSettings(next: SettingsFile): Promise<void> {
  try {
    await window.sampler.settings.write(next);
  } catch (err) {
    console.warn('Failed to persist settings', err);
  }
}

export const useSampler = create<SamplerState>((set, get) => ({
  bank: defaultBank(),
  recording: 'idle',
  editingPadId: null,
  chopOpen: false,
  pianoOpen: false,
  loadedPadIds: new Set(),
  loopPlaying: new Set(),
  loopLoadedSlotIds: new Set(),
  looperRecordingSlot: null,
  settings: defaultSettings(),
  deviceError: null,

  setBank: (bank) => set({ bank }),
  selectPad: (padId) =>
    set((s) => ({ bank: { ...s.bank, selectedPadId: padId } })),
  updatePad: (padId, patch) =>
    set((s) => ({
      bank: {
        ...s.bank,
        pads: s.bank.pads.map((p) => (p.id === padId ? { ...p, ...patch } : p))
      }
    })),
  updateLooper: (slotId, patch) =>
    set((s) => ({
      bank: {
        ...s.bank,
        loopers: s.bank.loopers.map((l) => (l.id === slotId ? { ...l, ...patch } : l))
      }
    })),
  setRecording: (recording) => set({ recording }),
  openEditor: (padId) => set({ editingPadId: padId }),
  closeEditor: () => set({ editingPadId: null }),
  openChop: () => set({ chopOpen: true }),
  closeChop: () => set({ chopOpen: false }),
  openPiano: () => set({ pianoOpen: true }),
  closePiano: () => set({ pianoOpen: false }),
  markPadLoaded: (padId) =>
    set((s) => {
      if (s.loadedPadIds.has(padId)) return s;
      const next = new Set(s.loadedPadIds);
      next.add(padId);
      return { loadedPadIds: next };
    }),
  markPadUnloaded: (padId) =>
    set((s) => {
      if (!s.loadedPadIds.has(padId)) return s;
      const next = new Set(s.loadedPadIds);
      next.delete(padId);
      return { loadedPadIds: next };
    }),

  markLoopLoaded: (slotId) =>
    set((s) => {
      if (s.loopLoadedSlotIds.has(slotId)) return s;
      const next = new Set(s.loopLoadedSlotIds);
      next.add(slotId);
      return { loopLoadedSlotIds: next };
    }),
  markLoopUnloaded: (slotId) =>
    set((s) => {
      if (!s.loopLoadedSlotIds.has(slotId)) return s;
      const next = new Set(s.loopLoadedSlotIds);
      next.delete(slotId);
      return { loopLoadedSlotIds: next };
    }),
  markLoopPlaying: (slotId) =>
    set((s) => {
      if (s.loopPlaying.has(slotId)) return s;
      const next = new Set(s.loopPlaying);
      next.add(slotId);
      return { loopPlaying: next };
    }),
  markLoopStopped: (slotId) =>
    set((s) => {
      if (!s.loopPlaying.has(slotId)) return s;
      const next = new Set(s.loopPlaying);
      next.delete(slotId);
      return { loopPlaying: next };
    }),
  setLooperRecordingSlot: (slotId) => set({ looperRecordingSlot: slotId }),

  setSettings: (settings) => set({ settings }),
  setPrimaryOutputDeviceId: async (id) => {
    // Same device on both → drop monitor to avoid double output.
    const prev = get().settings;
    const next: SettingsFile = {
      ...prev,
      primaryOutputDeviceId: id,
      monitorOutputDeviceId:
        id !== null && prev.monitorOutputDeviceId === id ? null : prev.monitorOutputDeviceId
    };
    set({ settings: next });
    audioEngine.armUserGesture();
    audioEngine.setPrimaryOutput(next.primaryOutputDeviceId);
    if (next.monitorOutputDeviceId !== prev.monitorOutputDeviceId) {
      audioEngine.setMonitorOutput(next.monitorOutputDeviceId);
    }
    await persistSettings(next);
  },
  setMonitorOutputDeviceId: async (id) => {
    const prev = get().settings;
    const sameAsPrimary = id !== null && id === prev.primaryOutputDeviceId;
    const resolved = sameAsPrimary ? null : id;
    const next: SettingsFile = { ...prev, monitorOutputDeviceId: resolved };
    set({ settings: next });
    audioEngine.armUserGesture();
    audioEngine.setMonitorOutput(next.monitorOutputDeviceId);
    await persistSettings(next);
  },
  setRecordingSource: async (source) => {
    const prev = get().settings;
    if (prev.recordingSource === source) return;
    const next: SettingsFile = { ...prev, recordingSource: source };
    set({ settings: next });
    await persistSettings(next);
  },
  setDeviceError: (deviceError) => set({ deviceError })
}));

audioEngine.onDeviceError((err) => {
  useSampler.getState().setDeviceError(err);
});
