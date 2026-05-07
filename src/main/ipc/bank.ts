import { ipcMain } from 'electron';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { IPC } from '../../shared/ipc-contract';
import { defaultBank, type BankFile } from '../../shared/bank-schema';
import { resolveBankFile } from '../paths';

export function registerBankIpc(): void {
  ipcMain.handle(IPC.bankRead, async (): Promise<BankFile> => {
    const path = await resolveBankFile();
    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw) as BankFile;
      if (parsed.version !== 1) return defaultBank();
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const fresh = defaultBank();
        await writeBankAtomic(path, fresh);
        return fresh;
      }
      throw err;
    }
  });

  ipcMain.handle(IPC.bankWrite, async (_e, bank: BankFile): Promise<void> => {
    const path = await resolveBankFile();
    await writeBankAtomic(path, bank);
  });
}

async function writeBankAtomic(path: string, bank: BankFile): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(bank, null, 2), 'utf-8');
  await rename(tmp, path);
}
