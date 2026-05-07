import { app, session, desktopCapturer, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { registerBankIpc } from './ipc/bank';
import { registerSamplesIpc } from './ipc/samples';
import { registerModelsIpc } from './ipc/models';
import { registerBankIoIpc } from './ipc/bankio';
import { registerSettingsIpc } from './ipc/settings';
import { registerAppIpc, initAutoUpdater } from './ipc/app';

app.whenReady().then(() => {
  // Register loopback handler BEFORE any renderer can call getDisplayMedia.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const first = sources[0];
          if (!first) {
            callback({});
            return;
          }
          callback({ video: first, audio: 'loopback' });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false }
  );

  registerBankIpc();
  registerSamplesIpc();
  registerModelsIpc();
  registerBankIoIpc();
  registerSettingsIpc();
  registerAppIpc();
  createMainWindow();
  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
