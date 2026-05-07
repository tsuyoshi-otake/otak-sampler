# Claude project notes — otak-sampler

This file is read by Claude Code when working in this repo. Keep it short and high-signal — long preambles waste context.

## What this project is

Windows desktop sampler built on Electron 32 + React 19 + TypeScript (strict). Records Windows loopback audio to 12 keyboard-triggered pads with waveform editing, ONNX-based vocal separation, and a chop-and-assign workflow.

## Daily commands

| Task | Command |
| --- | --- |
| Run dev (HMR) | `npm run dev` |
| Type-check both tsconfigs | `npm run lint` |
| Run tests | `npm test` |
| Production bundle | `npm run build` |
| NSIS installer (~99 MB) | `npm run package` |

The user is on Windows / PowerShell. If shelling out to non-Bash, mind PowerShell syntax (`$env:VAR`, `$null`, backtick line continuation).

## Where things live

```
src/main/                  Electron main; loopback handler in index.ts
src/main/ipc/              bank, samples, models, bankio handlers
src/preload/               contextBridge: window.sampler.{samples,bank,models,bankIo}
src/renderer/              React app
src/renderer/audio/        AudioEngine, recorder, WAV encoder, OfflineAudioContext editor
src/renderer/audio/dsp/    STFT/iSTFT, FFT (Bluestein), resample, vocalSeparator
src/renderer/components/   Toolbar, PadGrid, Pad, WaveformEditor, ChopMode, etc.
src/renderer/state/        Zustand store + hydrate helper
src/shared/                IPC contract types + bank schema (PAD_COUNT=12)
tests/audio/               Jest unit tests for DSP and WAV encoder
scripts/copy-ort-wasm.mjs  Pre-build copy of ORT WASM into renderer public/ort/
```

## Hard-won gotchas — read before changing audio code

- **Loopback handler timing.** `session.setDisplayMediaRequestHandler` MUST be registered in `app.whenReady` *before* any window is created or any renderer can call `getDisplayMedia`. Wrong order silently breaks recording.
- **AudioContext autoplay policy.** Browsers block AudioContext creation outside a user gesture. `AudioEngine.context()` lazy-creates on first user-triggered call.
- **Sample rate.** We force `new AudioContext({ sampleRate: 48000 })` so the renderer matches Windows loopback's typical 48 kHz and avoids implicit Web Audio resampling.
- **FFT size 6144 is NOT a power of two.** `fft.js` is power-of-two only. We wrap it with a Bluestein chirp-z transform in `src/renderer/audio/dsp/fft.ts`. Note that fft.js's `inverseTransform` already includes the 1/N normalization — do not divide by N again on top of it.
- **STFT semantics.** `src/renderer/audio/dsp/stft.ts` implements librosa-compatible `center=True` STFT with Hann *periodic* (not symmetric) window. iSTFT uses overlap-add normalized by summed window² (librosa convention). Roundtrip tests in `tests/audio/stft.test.ts` guard this.
- **MDX-Net Voc_FT input layout.** Tensor shape is `[1, 4, 3072, 256]` — that is `[batch, (L_real, L_imag, R_real, R_imag), dim_f, dim_t]`. **`dim_f` is 3072, NOT 2048** (2048 is for other MDX variants like Kim_Vocal_2). Output is the predicted vocal spectrogram; multiply by `compensate = 1.009`. Instrumental is computed by sample-aligned subtraction `mix - vocals` in 44.1 kHz space, then resampled.
- **Chunking.** Each chunk is `chunk = (dim_t - 1) * hop = 261120` samples (5.93 s @ 44.1 kHz). Pad input by `trim = n_fft / 2 = 3072` zeros on each side, slide by `gen = chunk - 2 * trim = 254976`, drop `trim` samples from each side of every iSTFT result before concatenating.
- **ORT WASM bundling.** The renderer Vite config uses the `onnxruntime-web-use-extern-wasm` resolve condition so the WASM file is NOT bundled into the JS chunk. Instead `scripts/copy-ort-wasm.mjs` (run via `predev` / `prebuild`) copies it into `src/renderer/public/ort/`, and `vocalSeparator.ts` points `env.wasm.wasmPaths` at `new URL('./ort/', document.baseURI).href`.
- **ORT proxy worker.** We set `env.wasm.proxy = true` so inference runs in ORT's own worker. `numThreads = 1` keeps us out of `crossOriginIsolated` requirements.

## Persistence layout

```
%APPDATA%/otak-sampler/
  bank.json                              ← atomic tmp + rename
  samples/<padId>-<timestamp>.wav        ← per-pad samples
  models/UVR-MDX-NET-Voc_FT.onnx         ← downloaded on first vocal isolate
```

Bank export packs `bank.json` (with relative `samples/<file>` paths) and the WAVs into a single ZIP saved as `*.sampler`.

## Style and constraints

- TypeScript strict + `noUncheckedIndexedAccess`. When indexing arrays / typed arrays, default with `?? 0` (or similar) to satisfy the type narrowing.
- React 19 — `JSX.Element` is no longer global. Omit return-type annotations on components and let inference handle it. Don't `import { JSX } from 'react'` unless you have a specific reason.
- Comments: default to none. Only when the *why* is non-obvious (subtle invariants, framework quirks, references to research / spec). Don't restate what well-named code already says.
- No planning / decision documents in repo unless the user explicitly asks.
- Don't add features beyond what the task requires. Don't introduce abstractions for hypothetical futures.
- Keep boundaries clean: only validate at system boundaries (user input, external APIs). Don't add validation for impossible cases inside the codebase.

## Testing

Jest + ts-jest under `jsdom`. DSP tests are pure logic; no Web Audio mocks needed except for `OfflineAudioContext`, for which we use a tiny inline stub in `tests/audio/offlineRender.test.ts` (avoid `standardized-audio-context-mock` — it pulls in sinon's ESM bundle and breaks ts-jest parsing).

## Out of scope in v1 (don't drop these from the roadmap accidentally)

- AudioWorklet-based lossless PCM recorder (currently `MediaRecorder` Opus)
- Editor undo stack
- Mac / Linux builds
- Code signing (env-var hooks already present in `electron-builder.yml`)
- Keymap configuration UI (Zustand state already supports per-pad key remap)
- Auto-slice by transient detection in chop mode (only equal-N split is implemented)

## When in doubt

- Don't shell out to `find` / `grep` / `cat` — the Bash tool guidance says use `Glob` / `Grep` / `Read`.
- Don't run `npm run dev` and forget about it — leftover Electron instances steal port 5173 and lock the GPU cache. `TaskStop` it when finished.
- Don't change `dim_f` for the vocal separator without re-checking the model's actual input shape via `session.inputMetadata`.
