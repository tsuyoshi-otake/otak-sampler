import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import {
  IPC,
  type SamplerApi,
  type SamplesSaveRequest,
  type SamplesLoadRequest,
  type SamplesDeleteRequest,
  type ModelKey,
  type ModelProgressEvent
} from '../shared/ipc-contract';
import type { BankFile } from '../shared/bank-schema';

const api: SamplerApi = {
  samples: {
    save: (req: SamplesSaveRequest) => ipcRenderer.invoke(IPC.samplesSave, req),
    load: (req: SamplesLoadRequest) => ipcRenderer.invoke(IPC.samplesLoad, req),
    delete: (req: SamplesDeleteRequest) => ipcRenderer.invoke(IPC.samplesDelete, req)
  },
  bank: {
    read: () => ipcRenderer.invoke(IPC.bankRead),
    write: (bank: BankFile) => ipcRenderer.invoke(IPC.bankWrite, bank)
  },
  models: {
    ensure: (key: ModelKey) => ipcRenderer.invoke(IPC.modelsEnsure, key),
    onProgress: (cb: (event: ModelProgressEvent) => void) => {
      const handler = (_e: IpcRendererEvent, data: ModelProgressEvent): void => cb(data);
      ipcRenderer.on(IPC.modelsProgress, handler);
      return (): void => {
        ipcRenderer.removeListener(IPC.modelsProgress, handler);
      };
    }
  },
  bankIo: {
    export: () => ipcRenderer.invoke(IPC.bankExport),
    import: () => ipcRenderer.invoke(IPC.bankImport)
  }
};

contextBridge.exposeInMainWorld('sampler', api);
