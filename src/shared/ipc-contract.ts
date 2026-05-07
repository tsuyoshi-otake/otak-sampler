import type { BankFile } from './bank-schema';
import type { SettingsFile } from './settings-schema';

export const IPC = {
  samplesSave: 'samples:save',
  samplesLoad: 'samples:load',
  samplesDelete: 'samples:delete',
  bankRead: 'bank:read',
  bankWrite: 'bank:write',
  modelsEnsure: 'models:ensure',
  modelsProgress: 'models:progress',
  bankExport: 'bank:export',
  bankImport: 'bank:import',
  settingsRead: 'settings:read',
  settingsWrite: 'settings:write',
  appVersion: 'app:version',
  appOpenExternal: 'app:openExternal',
  updaterCheck: 'updater:check',
  updaterDownload: 'updater:download',
  updaterQuitAndInstall: 'updater:quitAndInstall',
  updaterEvent: 'updater:event'
} as const;

export type UpdaterEvent =
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'not-available'; version: string }
  | { kind: 'progress'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };

export type ModelKey = 'voc_ft';

export interface ModelProgressEvent {
  key: ModelKey;
  received: number;
  total: number;
}

export interface SamplesSaveRequest {
  padId: number;
  wav: ArrayBuffer;
}
export interface SamplesSaveResponse {
  path: string;
}

export interface SamplesLoadRequest {
  path: string;
}
export type SamplesLoadResponse = ArrayBuffer;

export interface SamplesDeleteRequest {
  path: string;
}

export type BankReadResponse = BankFile;
export type BankWriteRequest = BankFile;

export type SettingsReadResponse = SettingsFile;
export type SettingsWriteRequest = SettingsFile;

export interface SamplerApi {
  samples: {
    save: (req: SamplesSaveRequest) => Promise<SamplesSaveResponse>;
    load: (req: SamplesLoadRequest) => Promise<SamplesLoadResponse>;
    delete: (req: SamplesDeleteRequest) => Promise<void>;
  };
  bank: {
    read: () => Promise<BankReadResponse>;
    write: (bank: BankWriteRequest) => Promise<void>;
  };
  models: {
    ensure: (key: ModelKey) => Promise<ArrayBuffer>;
    onProgress: (cb: (event: ModelProgressEvent) => void) => () => void;
  };
  bankIo: {
    export: () => Promise<{ saved: boolean; path?: string }>;
    import: () => Promise<{ imported: boolean; bank?: BankFile }>;
  };
  settings: {
    read: () => Promise<SettingsReadResponse>;
    write: (settings: SettingsWriteRequest) => Promise<void>;
  };
  app: {
    version: () => Promise<string>;
    openExternal: (url: string) => Promise<void>;
  };
  updater: {
    check: () => Promise<void>;
    download: () => Promise<void>;
    quitAndInstall: () => Promise<void>;
    onEvent: (cb: (event: UpdaterEvent) => void) => () => void;
  };
}

declare global {
  interface Window {
    sampler: SamplerApi;
  }
}
