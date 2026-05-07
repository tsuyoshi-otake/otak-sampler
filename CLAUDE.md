# Claude project notes — otak-sampler

This file is read by Claude Code when working in this repo. Keep it short and high-signal — long preambles waste context.

## What this project is

Windows desktop sampler built on Electron 32 + React 19 + TypeScript (strict). Records either Windows loopback audio or microphone input to 12 keyboard-triggered pads with waveform editing, ONNX-based vocal separation, a chop-and-assign workflow, a 4-slot looper, a polyphonic piano mode (pitch-shifted single-pad), per-output-device routing for meeting use, and electron-updater self-update from a public GitHub release feed.

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
src/main/                  Electron main; loopback handler + app-ort:// protocol in index.ts
src/main/ipc/              bank, samples, models, bankio, settings, app (updater) handlers
src/preload/               contextBridge: window.sampler.{samples,bank,models,bankIo,settings,app,updater}
src/renderer/              React app
src/renderer/audio/        AudioEngine (masterGain + sink routing + looper + playNote), recorder (loopback | mic), loopbackError, WAV encoder
src/renderer/audio/dsp/    STFT/iSTFT, FFT (Bluestein), resample, vocalSeparator
src/renderer/components/   Toolbar, PadGrid, Pad, WaveformEditor, ChopMode, LooperPanel, LooperSlot, PianoMode, OutputDeviceMenu, RecordButton (with loopback/mic toggle), AboutMenu, UpdateBanner, etc.
src/renderer/state/        Zustand store + hydrate helper (loads pads + loopers + settings)
src/shared/                IPC contract + bank schema (PAD_COUNT=12, LOOPER_SLOT_COUNT=4) + settings schema (recordingSource: loopback | mic)
src/renderer/index.html    CSP includes 'wasm-unsafe-eval' + app-ort: scheme so ORT can compile its module
tests/audio/               Jest unit tests for DSP and WAV encoder
scripts/copy-ort-wasm.mjs  Pre-build copy of ORT WASM into renderer public/ort/ (also unpacked from asar)
```

## Hard-won gotchas — read before changing audio code

- **Loopback handler timing.** `session.setDisplayMediaRequestHandler` MUST be registered in `app.whenReady` *before* any window is created or any renderer can call `getDisplayMedia`. Wrong order silently breaks recording.
- **AudioContext autoplay policy.** Browsers block AudioContext creation outside a user gesture. `AudioEngine.context()` lazy-creates on first user-triggered call.
- **Sample rate.** We force `new AudioContext({ sampleRate: 48000 })` so the renderer matches Windows loopback's typical 48 kHz and avoids implicit Web Audio resampling.
- **FFT size 6144 is NOT a power of two.** `fft.js` is power-of-two only. We wrap it with a Bluestein chirp-z transform in `src/renderer/audio/dsp/fft.ts`. Note that fft.js's `inverseTransform` already includes the 1/N normalization — do not divide by N again on top of it.
- **STFT semantics.** `src/renderer/audio/dsp/stft.ts` implements librosa-compatible `center=True` STFT with Hann *periodic* (not symmetric) window. iSTFT uses overlap-add normalized by summed window² (librosa convention). Roundtrip tests in `tests/audio/stft.test.ts` guard this.
- **MDX-Net Voc_FT input layout.** Tensor shape is `[1, 4, 3072, 256]` — that is `[batch, (L_real, L_imag, R_real, R_imag), dim_f, dim_t]`. **`dim_f` is 3072, NOT 2048** (2048 is for other MDX variants like Kim_Vocal_2). Output is the predicted vocal spectrogram; multiply by `compensate = 1.009`. Instrumental is computed by sample-aligned subtraction `mix - vocals` in 44.1 kHz space, then resampled.
- **Chunking.** Each chunk is `chunk = (dim_t - 1) * hop = 261120` samples (5.93 s @ 44.1 kHz). Pad input by `trim = n_fft / 2 = 3072` zeros on each side, slide by `gen = chunk - 2 * trim = 254976`, drop `trim` samples from each side of every iSTFT result before concatenating.
- **ORT WASM bundling — read this whole block before touching anything.** Getting vocal separation to load in a packaged build took five releases (v0.9.4 → v0.9.10) of failed attempts. The current scheme is the one that works; do not "simplify" it without understanding why each piece exists.
  - The renderer Vite config uses the `onnxruntime-web-use-extern-wasm` resolve condition so the WASM file is NOT bundled into the JS chunk. `scripts/copy-ort-wasm.mjs` (run via `predev` / `prebuild`) copies the .mjs + .wasm into `src/renderer/public/ort/`.
  - For packaged builds, `electron-builder.yml` declares `asarUnpack: out/renderer/ort/**` so the files exist as real files on disk under `resources/app.asar.unpacked/out/renderer/ort/` (Chromium's ESM resolver and WebAssembly loader cannot follow asar's transparent redirect for these paths).
  - The main process registers a privileged `app-ort://` scheme (`protocol.registerSchemesAsPrivileged` BEFORE `app.whenReady`) and serves the .mjs / .wasm via `protocol.handle('app-ort', ...)` with explicit `Content-Type: text/javascript` / `application/wasm` headers. Don't try to use `file://` directly — Chromium gets MIME wrong on .mjs and ESM dynamic import refuses it.
  - The renderer (`vocalSeparator.ts → ensureOrtBlobs()`) fetches both files through `app-ort://wasm/...`, wraps the ArrayBuffers in `Blob`s, and hands ORT `wasmPaths = { mjs: blobUrl, wasm: blobUrl }`. Blob URLs are accepted by the ESM dynamic import + WebAssembly loader in every context (file://, asar, custom protocol all reject one or the other).
- **ORT proxy worker is disabled.** `env.wasm.proxy = false`. Setting it to `true` makes ORT spawn `new Worker(scriptSrc, { type: 'module' })` against the script URL — Chromium rejects file:// module workers in packaged Electron, even when the file is unpacked. Inference runs on the main renderer thread instead; the existing progress UI covers the 5–15 s freeze. `numThreads = 1` keeps us out of `crossOriginIsolated` requirements.
- **CSP must allow `'wasm-unsafe-eval'`.** `src/renderer/index.html` sets `default-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' data: blob: ws: wss: app-ort: http://localhost:* http://127.0.0.1:*`. Without `'wasm-unsafe-eval'`, Chromium throws `CompileError: WebAssembly.instantiate(): Refused to compile or instantiate WebAssembly module because 'unsafe-eval' is not an allowed source of script` and the `proxy: false` path surfaces the error directly (with `proxy: true` it gets wrapped in an opaque worker `Event`, which is what hid the real cause for several releases). `app-ort:` and `blob:` in the CSP are also load-bearing — both are part of the WASM init chain.
- **AudioEngine has a masterGain.** All playback (`play`, `playLoop`, `playNote`) connects through `this.masterGain` rather than `ctx.destination` directly. This is what lets `setSinkId` (Primary) and the `MediaStreamAudioDestinationNode` tap (Monitor) redirect everything in one place. Don't connect new audio paths straight to `ctx.destination` — they would bypass routing.
- **Sink switches need a user gesture.** `AudioEngine.flushDesired()` only calls `setSinkId` / `audio.play()` after `armUserGesture()` flips a flag. `play()`, `record()`, and the OutputDeviceMenu setters arm it. Hydrate-time calls just stage the desired device IDs. Ignoring this caused autoplay-policy rejects on cold launch.
- **Piano mode keymap uses `event.code`, not `event.key`.** That's what makes it work on JIS and US layouts — `Quote` and `Backslash` are positionally consistent even though the printed character differs. Labels for the on-screen keyboard come from `navigator.keyboard.getLayoutMap()` when supported, falling back to US characters.
- **Piano mapping is diatonic, not chromatic.** Both rows walk consecutive white keys (C major from root) so visual order on the on-screen piano matches typing order. Black keys are mouse-only — they don't get a computer-key shortcut. Don't switch back to chromatic without remapping the visual labels too, otherwise typing produces a zigzag across white/black rows that reads as broken.
- **Recording source toggle (Loopback / Mic).** `RecordButton` exposes a two-state pill that drives `settings.recordingSource`. `audioEngine.record(source)` forwards to `startRecorder(ctx, source)` which branches between `getDisplayMedia({ audio: true, video: true })` (loopback, video tracks stripped immediately) and `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }})` (mic, raw — meeting-app DSP disabled because we want the unprocessed signal). The hint maps in `src/renderer/audio/loopbackError.ts` are keyed off this source so error alerts give Windows-specific advice for the right device class.
- **Looper recording reuses `samples:save` with a padId offset.** Loop slot N saves as `padId = 100 + N` so filenames stay collision-free without adding a new IPC. The bank's `loopers[]` array stores the absolute path.
- **Bank schema is forward-compatible.** New optional fields (e.g. `loopers`) are normalized in `src/main/ipc/bank.ts` on read; the version stays at 1 until a real breaking change.
- **`stopAll()` stops loops too.** Toolbar Stop all kills both pad voices and looper voices. The Looper panel has its own "Stop loops" button if you only want to halt loops.
- **electron-updater fetches anonymously.** The repo is public, so `publish.provider: github` (in `electron-builder.yml`) embeds a public feed URL and the runtime fetch needs no token. Don't bake any GitHub token into the binary — there's no reason to and it would be leaked the moment a user shared the installer.
- **`autoDownload = false` is intentional.** The renderer's UpdateBanner exposes the four states (available / downloading / ready / error) and lets the user opt in. Auto-downloading would surprise the user with bandwidth use during active sampling.
- **`shell.openExternal` is gated to github.com in main.** `src/main/ipc/app.ts` rejects any other URL prefix. Don't widen this without thinking about phishing surface — the main process can navigate the user anywhere.
- **Installer auto-uninstalls the old version on upgrade.** electron-builder NSIS detects the existing install via `HKCU\Software\<appId>` and silently runs the prior uninstaller before installing the new build. `deleteAppDataOnUninstall: false` keeps user data (`%APPDATA%\otak-sampler`) intact across the swap. Don't change this without thinking about migration.
- **Electron default menu is hidden.** `src/main/window.ts` calls `Menu.setApplicationMenu(null)` plus `autoHideMenuBar: true` + `setMenuBarVisibility(false)` so the File / Edit / View / … bar never appears. All app actions live in the in-app Toolbar. Don't restore the default menu without thinking about the visual cost on a 600px-tall window.

## Persistence layout

```
%APPDATA%/otak-sampler/
  bank.json                              ← pads, keymap, loopers (atomic tmp + rename)
  settings.json                          ← primary / monitor output device IDs
  samples/<padId>-<timestamp>.wav        ← per-pad samples (padId 0..11)
  samples/<padId>-<timestamp>.wav        ← looper slots saved with padId 100+slotId
  models/UVR-MDX-NET-Voc_FT.onnx         ← downloaded on first vocal isolate
```

Bank export packs `bank.json` (with relative `samples/<file>` paths) and the WAVs (pads + loopers) into a single ZIP saved as `*.sampler`. `settings.json` is per-machine and not exported.

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
- Looper tempo sync / tap tempo / quantization
- Looper overdub (re-record on top of a playing loop)
- Piano-mode root-note persistence per pad (currently modal-local)
- Pitch-preserving time-stretch (current piano mode is `playbackRate` only)

## When in doubt

- Don't shell out to `find` / `grep` / `cat` — the Bash tool guidance says use `Glob` / `Grep` / `Read`.
- Don't run `npm run dev` and forget about it — leftover Electron instances steal port 5173 and lock the GPU cache. `TaskStop` it when finished.
- Don't change `dim_f` for the vocal separator without re-checking the model's actual input shape via `session.inputMetadata`.
