import { ipcMain, net, BrowserWindow } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { IPC, type ModelKey, type ModelProgressEvent } from '../../shared/ipc-contract';
import { resolveDataRoot } from '../paths';

interface ModelMeta {
  url: string;
  file: string;
}

const MODELS: Record<ModelKey, ModelMeta> = {
  voc_ft: {
    url: 'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-MDX-NET-Voc_FT.onnx',
    file: 'UVR-MDX-NET-Voc_FT.onnx'
  }
};

export function registerModelsIpc(): void {
  ipcMain.handle(IPC.modelsEnsure, async (event, key: ModelKey): Promise<ArrayBuffer> => {
    const meta = MODELS[key];
    if (!meta) throw new Error(`Unknown model: ${key}`);

    const dir = join(await resolveDataRoot(), 'models');
    await mkdir(dir, { recursive: true });
    const path = join(dir, meta.file);

    // Use cached file if present.
    try {
      const buf = await readFile(path);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await net.fetch(meta.url, { redirect: 'follow' });
    if (!res.ok || !res.body) {
      throw new Error(`Model download failed: ${res.status} ${res.statusText}`);
    }

    const total = Number.parseInt(res.headers.get('content-length') ?? '0', 10);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      received += value.byteLength;
      const progress: ModelProgressEvent = { key, received, total };
      win?.webContents.send(IPC.modelsProgress, progress);
    }

    const merged = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
    await writeFile(path, merged);
    return merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength) as ArrayBuffer;
  });
}
