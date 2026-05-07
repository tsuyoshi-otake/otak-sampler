// Bank export / import as a single .sampler zip file:
//   bank.json              — copy of the bank with samplePath rewritten to "samples/<file>"
//   samples/<file>.wav     — one entry per pad that has a sample
//
// On import, samples are unpacked into <userData>/otak-sampler/samples/ with
// fresh timestamps to avoid filename collisions; bank.json is rewritten with
// the resolved absolute paths and persisted.

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import { IPC } from '../../shared/ipc-contract';
import { type BankFile, defaultBank } from '../../shared/bank-schema';
import { resolveBankFile, resolveDataRoot, resolveSamplesDir } from '../paths';

export function registerBankIoIpc(): void {
  ipcMain.handle(IPC.bankExport, async (event): Promise<{ saved: boolean; path?: string }> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      title: 'Export bank',
      defaultPath: `otak-sampler-bank-${dateStamp()}.sampler`,
      filters: [{ name: 'otak-sampler bank', extensions: ['sampler', 'zip'] }]
    };
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return { saved: false };

    const bankPath = await resolveBankFile();
    const bankJson = await readFile(bankPath, 'utf-8').catch(() => null);
    const bank: BankFile = bankJson ? (JSON.parse(bankJson) as BankFile) : defaultBank();

    const zip = new JSZip();
    const exportBank: BankFile = {
      ...bank,
      pads: await Promise.all(
        bank.pads.map(async (pad) => {
          if (!pad.samplePath) return { ...pad };
          try {
            const wav = await readFile(pad.samplePath);
            const name = basename(pad.samplePath);
            zip.file(`samples/${name}`, wav);
            return { ...pad, samplePath: `samples/${name}` };
          } catch {
            return { ...pad, samplePath: null };
          }
        })
      )
    };
    zip.file('bank.json', JSON.stringify(exportBank, null, 2));

    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await writeFile(result.filePath, bytes);
    return { saved: true, path: result.filePath };
  });

  ipcMain.handle(IPC.bankImport, async (event): Promise<{ imported: boolean; bank?: BankFile }> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts: Electron.OpenDialogOptions = {
      title: 'Import bank',
      properties: ['openFile'],
      filters: [{ name: 'otak-sampler bank', extensions: ['sampler', 'zip'] }]
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return { imported: false };
    const src = result.filePaths[0];
    if (!src) return { imported: false };

    const bytes = await readFile(src);
    const zip = await JSZip.loadAsync(bytes);

    const bankEntry = zip.file('bank.json');
    if (!bankEntry) throw new Error('bank.json not found in archive');
    const bankRaw = await bankEntry.async('string');
    const incoming = JSON.parse(bankRaw) as BankFile;

    const dataRoot = await resolveDataRoot();
    const samplesDir = await resolveSamplesDir();
    await mkdir(samplesDir, { recursive: true });

    const ts = Date.now();
    const restoredPads = await Promise.all(
      incoming.pads.map(async (pad, i) => {
        if (!pad.samplePath) return { ...pad, samplePath: null };
        const entry = zip.file(pad.samplePath);
        if (!entry) return { ...pad, samplePath: null };
        const wav = await entry.async('nodebuffer');
        const ext = extname(pad.samplePath) || '.wav';
        const fileName = `${pad.id}-${ts}-${i}${ext}`;
        const outPath = join(samplesDir, fileName);
        await writeFile(outPath, wav);
        return { ...pad, samplePath: outPath };
      })
    );

    const restored: BankFile = { ...incoming, pads: restoredPads };
    const bankPath = join(dataRoot, 'bank.json');
    const tmp = `${bankPath}.tmp`;
    await writeFile(tmp, JSON.stringify(restored, null, 2), 'utf-8');
    await rename(tmp, bankPath);
    return { imported: true, bank: restored };
  });
}

function dateStamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
