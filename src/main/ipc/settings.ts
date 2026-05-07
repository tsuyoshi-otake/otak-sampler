import { ipcMain } from 'electron';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { IPC } from '../../shared/ipc-contract';
import { defaultSettings, type SettingsFile } from '../../shared/settings-schema';
import { resolveSettingsFile } from '../paths';

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settingsRead, async (): Promise<SettingsFile> => {
    const path = await resolveSettingsFile();
    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<SettingsFile> & { version: number };
      if (parsed.version !== 1) return defaultSettings();
      return { ...defaultSettings(), ...parsed, version: 1 } as SettingsFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const fresh = defaultSettings();
        await writeSettingsAtomic(path, fresh);
        return fresh;
      }
      throw err;
    }
  });

  ipcMain.handle(IPC.settingsWrite, async (_e, settings: SettingsFile): Promise<void> => {
    const path = await resolveSettingsFile();
    await writeSettingsAtomic(path, settings);
  });
}

async function writeSettingsAtomic(path: string, settings: SettingsFile): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2), 'utf-8');
  await rename(tmp, path);
}
