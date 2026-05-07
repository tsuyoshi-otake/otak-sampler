# otak-sampler

A 12-pad Windows desktop sampler that records whatever is currently playing on your PC, lets you edit waveforms inline, optionally splits vocals from instrumentation with an ONNX model, and chops long recordings into per-pad slices.

## Features

- **System audio loopback recording** via `setDisplayMediaRequestHandler({ audio: 'loopback' })` — capture anything Windows is playing without a virtual cable.
- **12 pads in a 4 × 3 grid**, default keymap `1 2 3 4 / Q W E R / A S D F`. Press any key while the window has focus to play. Polyphonic — multiple pads can play at once.
- **Inline waveform editor** with trim region (drag handles), fade-in / fade-out, and gain. Live cursor while previewing.
- **AI vocal separation** powered by [UVR-MDX-NET-Voc_FT](https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-MDX-NET-Voc_FT.onnx) running locally via [onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/). Two buttons in the editor:
  - **Vocal isolate** — keep the vocal stem
  - **Vocal cut** — keep the instrumental (mix − vocals)
  Model (≈67 MB) is downloaded on first use and cached under `%APPDATA%`.
- **Chop mode** — load or record a long source, drag-select multiple slices on the waveform, and assign each slice to a pad with one click. Auto-equal split into 2 / 4 / 8 / 12 segments.
- **Bank export / import** as a single `.sampler` file (ZIP containing `bank.json` + WAVs) — share an entire kit in one drag-and-drop.
- **Persistent across launches** — pads, samples, and the keymap live in `%APPDATA%/otak-sampler/`.

## Stack

Electron 32 · React 19 · TypeScript (strict) · Vite (via electron-vite) · Zustand · Tailwind CSS · [wavesurfer.js v7](https://wavesurfer.xyz/) (Regions plugin) · [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) (WASM EP) · Jest.

## Install

### Pre-built installer (Windows x64)

Download `otak-sampler-<version>-setup.exe` from the latest release and run it. The installer is unsigned, so SmartScreen will warn on first launch — click **More info → Run anyway**.

### Build from source

```powershell
git clone https://github.com/tsuyoshi-otake/otak-sampler.git
cd otak-sampler
npm install
npm run dev      # launches the app with HMR
```

To produce the installer yourself:

```powershell
npm run package
# Output: dist/otak-sampler-<version>-setup.exe (~99 MB)
```

## Usage

1. **Pick a pad** by clicking it (the selected pad has a green border).
2. **Record** by clicking ● *Record* in the toolbar — Electron will request screen-share permission once; this is the loopback gate, accept it. Whatever is playing on your PC starts being captured.
3. **Stop** with ■ *Stop*. The clip lands on the selected pad.
4. **Play** by clicking the pad, or press its keyboard letter.
5. **Edit** with double-click on the pad. Drag the green region's handles to trim, slide *Fade in / Fade out / Gain*, optionally hit **Vocal isolate** / **Vocal cut**, then **Save**.
6. **Chop** a longer recording: toolbar → *Chop*. Record or **Load WAV…**, drag on the waveform to add slices (or **Auto Equal × N**), click any pad number on a slice's row to commit it.
7. **Share** a kit: toolbar → *Export* → save the `.sampler` file. On another machine, *Import* the same file.

## Project layout

```
src/
  main/                 Electron main process
    index.ts            Loopback handler (registered before window creation), IPC bootstrap
    window.ts           BrowserWindow setup
    ipc/
      bank.ts           bank.json read/write (atomic tmp + rename)
      samples.ts        WAV save / load / delete
      models.ts         Model fetch from Hugging Face + userData cache + progress events
      bankio.ts         Bank export / import as .sampler ZIP (jszip)
  preload/
    index.ts            contextBridge → window.sampler.{ samples, bank, models, bankIo }
  renderer/             React app
    audio/
      AudioEngine.ts        Shared AudioContext, polyphonic playback
      recorder.ts           MediaRecorder (audio/webm; codecs=opus) + AnalyserNode level meter
      encodeWav.ts          AudioBuffer → 16-bit PCM WAV
      offlineRender.ts      Trim + fade + gain via OfflineAudioContext
      dsp/
        fft.ts              Arbitrary-size DFT via Bluestein layered on fft.js
        stft.ts             Hann periodic, librosa-compatible center=True STFT/iSTFT
        resample.ts         48k ↔ 44.1k via OfflineAudioContext
        vocalSeparator.ts   UVR-MDX-NET-Voc_FT pipeline
    components/
      Toolbar.tsx           Record / Edit / Clear / Stop all / Chop / Export / Import
      PadGrid.tsx, Pad.tsx
      RecordButton.tsx, LevelMeter.tsx
      WaveformEditor.tsx    wavesurfer + Regions + Vocal AI + preview cursor
      ChopMode.tsx          Multi-region slicing + per-pad assignment
      KeyboardListener.tsx
    state/
      store.ts              Zustand
      hydrate.ts            Replace bank + reload all sample buffers
  shared/                   IPC contract types + bank schema
tests/audio/                Jest tests for FFT / STFT / encodeWav / offlineRender
scripts/copy-ort-wasm.mjs   Pre-bundle copy of ORT WASM into renderer/public/ort/
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Launch the app via electron-vite (main + preload + renderer with HMR). |
| `npm run lint` | Type-check main and renderer (`tsc --noEmit`). |
| `npm test` | Jest unit tests. |
| `npm run build` | Production bundle to `out/`. |
| `npm run package` | Build + NSIS installer in `dist/` (Windows x64). |

## Notes and limitations

- **Windows x64 only** in v1. Mac/Linux out of scope until I have something to test against.
- **Recordings use Opus** (`audio/webm; codecs=opus`) — lossy. AudioWorklet-based PCM recording is on the v1.1 list.
- **Keyboard triggers are window-local**, not global hotkeys. Pads fire only when the otak-sampler window has focus and an editable element doesn't.
- **Vocal separation runs in WASM CPU**, single-threaded. Expect roughly 5–15 s of inference for a 5 s clip. Quality is best on commercial-style mixes; weaker on speech, mono sources, or sparse mixes. The model is fixed-format: 44.1 kHz stereo, internally chunked as 5.93 s segments.
- **Bank import overwrites in-memory state** but doesn't delete previous sample WAVs from disk — they linger in `samples/` until you clear the pad.
- **Installer is unsigned.** Code signing infrastructure is wired in `electron-builder.yml` via the `CSC_LINK` / `CSC_KEY_PASSWORD` env-var convention, but no certificate is bundled.

## License

MIT — see [LICENSE](./LICENSE).
