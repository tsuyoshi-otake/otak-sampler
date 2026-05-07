import { app } from 'electron';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

let cachedRoot: string | null = null;

export async function resolveDataRoot(): Promise<string> {
  if (cachedRoot) return cachedRoot;
  const root = join(app.getPath('userData'), 'otak-sampler');
  await mkdir(root, { recursive: true });
  await mkdir(join(root, 'samples'), { recursive: true });
  cachedRoot = root;
  return root;
}

export async function resolveSamplesDir(): Promise<string> {
  const root = await resolveDataRoot();
  return join(root, 'samples');
}

export async function resolveBankFile(): Promise<string> {
  const root = await resolveDataRoot();
  return join(root, 'bank.json');
}
