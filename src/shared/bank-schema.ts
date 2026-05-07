export const PAD_COUNT = 12;
export const LOOPER_SLOT_COUNT = 4;

export const DEFAULT_KEYS: readonly string[] = [
  '1', '2', '3', '4',
  'q', 'w', 'e', 'r',
  'a', 's', 'd', 'f'
];

export interface PadConfig {
  id: number;
  name: string;
  samplePath: string | null;
  gainDb: number;
  key: string;
}

export interface LooperSlotConfig {
  id: number;
  name: string;
  samplePath: string | null;
  gainDb: number;
}

export interface BankFile {
  version: 1;
  selectedPadId: number;
  pads: PadConfig[];
  keymap: Record<string, number>;
  loopers: LooperSlotConfig[];
}

export function defaultLoopers(): LooperSlotConfig[] {
  const slots: LooperSlotConfig[] = [];
  for (let i = 0; i < LOOPER_SLOT_COUNT; i++) {
    slots.push({
      id: i,
      name: `L${i + 1}`,
      samplePath: null,
      gainDb: 0
    });
  }
  return slots;
}

export function defaultBank(): BankFile {
  const pads: PadConfig[] = [];
  const keymap: Record<string, number> = {};
  for (let i = 0; i < PAD_COUNT; i++) {
    const key = DEFAULT_KEYS[i] ?? '';
    pads.push({
      id: i,
      name: `Pad ${i + 1}`,
      samplePath: null,
      gainDb: 0,
      key
    });
    if (key) keymap[key] = i;
  }
  return {
    version: 1,
    selectedPadId: 0,
    pads,
    keymap,
    loopers: defaultLoopers()
  };
}
