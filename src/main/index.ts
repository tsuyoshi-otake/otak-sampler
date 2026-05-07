import { app, session, desktopCapturer, BrowserWindow, protocol, net } from 'electron';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createMainWindow } from './window';
import { registerBankIpc } from './ipc/bank';
import { registerSamplesIpc } from './ipc/samples';
import { registerModelsIpc } from './ipc/models';
import { registerBankIoIpc } from './ipc/bankio';
import { registerSettingsIpc } from './ipc/settings';
import { registerAppIpc, initAutoUpdater } from './ipc/app';

// onnxruntime-web's WASM runtime ships as a .mjs ES module + .wasm. In a
// packaged build the file:// MIME for .mjs and the asar transparent redirect
// don't agree with Chromium's dynamic ES module loader, so we serve the ort/
// directory from a dedicated protocol with explicit Content-Type headers.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-ort',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
]);

app.whenReady().then(() => {
  protocol.handle('app-ort', async (request) => {
    const url = new URL(request.url);
    const filename = url.pathname.replace(/^\/+/, '');
    const baseDir = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'out', 'renderer', 'ort')
      : join(app.getAppPath(), 'src', 'renderer', 'public', 'ort');
    const fullPath = join(baseDir, filename);
    try {
      const response = await net.fetch(pathToFileURL(fullPath).href);
      const buf = await response.arrayBuffer();
      const mime = filename.endsWith('.wasm')
        ? 'application/wasm'
        : 'text/javascript; charset=utf-8';
      return new Response(buf, {
        headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' }
      });
    } catch (err) {
      return new Response(`Not found: ${filename}`, { status: 404 });
    }
  });

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
