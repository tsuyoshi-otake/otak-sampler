// Minimal electron stub for Jest. Tests should never import from electron directly,
// but ts-jest can hit it transitively through the IPC contract module.
export const app = {
  getPath: (_name: string): string => '',
  whenReady: (): Promise<void> => Promise.resolve(),
  on: (): void => undefined,
  quit: (): void => undefined
};
export const ipcMain = {
  handle: (): void => undefined
};
export const session = { defaultSession: { setDisplayMediaRequestHandler: (): void => undefined } };
export const desktopCapturer = { getSources: (): Promise<unknown[]> => Promise.resolve([]) };
export const BrowserWindow = class {};
export const contextBridge = { exposeInMainWorld: (): void => undefined };
export const ipcRenderer = { invoke: (): Promise<unknown> => Promise.resolve(undefined) };
