import { app, ipcMain, shell, BrowserWindow } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { IPC, type UpdaterEvent } from '../../shared/ipc-contract';

const RELEASES_HOST_PREFIXES = ['https://github.com/', 'https://www.github.com/'] as const;

export function registerAppIpc(): void {
  ipcMain.handle(IPC.appVersion, (): string => app.getVersion());

  ipcMain.handle(IPC.appOpenExternal, async (_e, url: string): Promise<void> => {
    if (!RELEASES_HOST_PREFIXES.some((p) => url.startsWith(p))) {
      throw new Error('External URL not allowed');
    }
    await shell.openExternal(url);
  });

  ipcMain.handle(IPC.updaterCheck, async (): Promise<void> => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });

  ipcMain.handle(IPC.updaterDownload, async (): Promise<void> => {
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });

  ipcMain.handle(IPC.updaterQuitAndInstall, (): void => {
    autoUpdater.quitAndInstall();
  });
}

function emit(event: UpdaterEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.updaterEvent, event);
  }
}

export function initAutoUpdater(): void {
  // electron-updater is no-op in dev / non-packaged builds.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => emit({ kind: 'checking' }));
  autoUpdater.on('update-available', (info: UpdateInfo) =>
    emit({ kind: 'available', version: info.version })
  );
  autoUpdater.on('update-not-available', (info: UpdateInfo) =>
    emit({ kind: 'not-available', version: info.version })
  );
  autoUpdater.on('download-progress', (progress: ProgressInfo) =>
    emit({ kind: 'progress', percent: progress.percent })
  );
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    emit({ kind: 'downloaded', version: info.version })
  );
  autoUpdater.on('error', (err) =>
    emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
  );

  // Initial check, but don't block app startup.
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(() => {
      /* surfaced via 'error' event */
    });
  }, 5000);
}
