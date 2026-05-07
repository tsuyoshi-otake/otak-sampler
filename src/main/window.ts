import { BrowserWindow, Menu } from 'electron';
import { join } from 'node:path';

export function createMainWindow(): BrowserWindow {
  // Drop the default Electron application menu (File / Edit / View / …).
  // Built-in shortcuts like Ctrl+Shift+I (DevTools) and clipboard editing
  // keep working without it.
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: '#0b0b0e',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
