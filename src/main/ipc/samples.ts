import { ipcMain } from 'electron';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';
import { Buffer } from 'node:buffer';
import {
  IPC,
  type SamplesSaveRequest,
  type SamplesSaveResponse,
  type SamplesLoadRequest,
  type SamplesDeleteRequest
} from '../../shared/ipc-contract';
import { resolveDataRoot, resolveSamplesDir } from '../paths';

export function registerSamplesIpc(): void {
  ipcMain.handle(
    IPC.samplesSave,
    async (_e, req: SamplesSaveRequest): Promise<SamplesSaveResponse> => {
      const dir = await resolveSamplesDir();
      const filename = `${req.padId}-${Date.now()}.wav`;
      const path = join(dir, filename);
      await writeFile(path, Buffer.from(req.wav));
      return { path };
    }
  );

  ipcMain.handle(IPC.samplesLoad, async (_e, req: SamplesLoadRequest): Promise<ArrayBuffer> => {
    await assertWithinDataRoot(req.path);
    const buf = await readFile(req.path);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  });

  ipcMain.handle(IPC.samplesDelete, async (_e, req: SamplesDeleteRequest): Promise<void> => {
    await assertWithinDataRoot(req.path);
    try {
      await unlink(req.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  });
}

async function assertWithinDataRoot(target: string): Promise<void> {
  const root = await resolveDataRoot();
  const normalizedRoot = resolve(root) + sep;
  const normalizedTarget = resolve(target);
  if (
    normalizedTarget !== resolve(root) &&
    !normalizedTarget.startsWith(normalizedRoot) &&
    dirname(normalizedTarget) + sep !== normalizedRoot
  ) {
    throw new Error(`Refusing access to path outside data root: ${target}`);
  }
}
