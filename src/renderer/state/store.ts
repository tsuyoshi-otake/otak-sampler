import { create } from 'zustand';
import { defaultBank, type BankFile, type PadConfig } from '../../shared/bank-schema';
import type { RecordingPhase } from './types';

interface SamplerState {
  bank: BankFile;
  recording: RecordingPhase;
  editingPadId: number | null;
  chopOpen: boolean;
  loadedPadIds: Set<number>; // pads whose AudioBuffer is in AudioEngine

  setBank: (bank: BankFile) => void;
  selectPad: (padId: number) => void;
  updatePad: (padId: number, patch: Partial<PadConfig>) => void;
  setRecording: (phase: RecordingPhase) => void;
  openEditor: (padId: number) => void;
  closeEditor: (savedPadId?: number) => void;
  openChop: () => void;
  closeChop: () => void;
  markPadLoaded: (padId: number) => void;
  markPadUnloaded: (padId: number) => void;
}

export const useSampler = create<SamplerState>((set) => ({
  bank: defaultBank(),
  recording: 'idle',
  editingPadId: null,
  chopOpen: false,
  loadedPadIds: new Set(),

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
  setRecording: (recording) => set({ recording }),
  openEditor: (padId) => set({ editingPadId: padId }),
  closeEditor: () => set({ editingPadId: null }),
  openChop: () => set({ chopOpen: true }),
  closeChop: () => set({ chopOpen: false }),
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
    })
}));
