// Copy onnxruntime-web's WASM runtime files into the renderer public dir so
// they ship as same-origin assets (avoids CSP and CDN dependencies in Electron).
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const src = resolve(repoRoot, 'node_modules/onnxruntime-web/dist');
const dst = resolve(repoRoot, 'src/renderer/public/ort');

const files = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

await mkdir(dst, { recursive: true });
for (const f of files) {
  await copyFile(resolve(src, f), resolve(dst, f));
  console.log(`copied ${f}`);
}
