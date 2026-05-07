import { useCallback, useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, {
  type Region
} from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { useSampler } from '../state/store';
import { audioEngine } from '../audio/AudioEngine';
import { encodeWav } from '../audio/encodeWav';
import { renderEdits } from '../audio/offlineRender';
import type { RecorderHandle } from '../audio/recorder';
import { LevelMeter } from './LevelMeter';
import { PAD_COUNT } from '../../shared/bank-schema';

interface Slice {
  id: string;
  start: number;
  end: number;
  assigned: number | null; // padId
}

export function ChopMode() {
  const open = useSampler((s) => s.chopOpen);
  if (!open) return null;
  return <ChopBody />;
}

function ChopBody() {
  const closeChop = useSampler((s) => s.closeChop);
  const updatePad = useSampler((s) => s.updatePad);
  const markPadLoaded = useSampler((s) => s.markPadLoaded);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [source, setSource] = useState<AudioBuffer | null>(null);
  const [slices, setSlices] = useState<Slice[]>([]);
  const [recState, setRecState] = useState<'idle' | 'recording'>('idle');
  const recorderRef = useRef<RecorderHandle | null>(null);
  const [busy, setBusy] = useState(false);

  // Recording into the chop source.
  const startRecord = useCallback(async () => {
    if (recState !== 'idle') return;
    try {
      const handle = await audioEngine.record();
      recorderRef.current = handle;
      setRecState('recording');
    } catch (err) {
      console.error('Chop record failed', err);
      window.alert('録音を開始できませんでした。');
    }
  }, [recState]);

  const stopRecord = useCallback(async () => {
    const handle = recorderRef.current;
    if (!handle) return;
    recorderRef.current = null;
    try {
      const blob = await handle.stop();
      const arr = await blob.arrayBuffer();
      const buf = await audioEngine.decode(arr);
      setSource(buf);
      setSlices([]);
    } catch (err) {
      console.error('Chop record finalize failed', err);
    } finally {
      setRecState('idle');
    }
  }, []);

  // Load a WAV/audio file as the source.
  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const arr = await file.arrayBuffer();
      const buf = await audioEngine.decode(arr);
      setSource(buf);
      setSlices([]);
    } catch (err) {
      console.error('File load failed', err);
      window.alert('ファイルを読み込めませんでした。');
    } finally {
      setBusy(false);
    }
  }, []);

  // Init wavesurfer when source changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !source) return;

    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container,
      waveColor: '#fbbf24',
      progressColor: '#f59e0b',
      cursorColor: '#fafafa',
      height: 160,
      normalize: true,
      plugins: [regions]
    });
    wsRef.current = ws;
    regionsRef.current = regions;

    const wav = encodeWav(source);
    void ws.loadBlob(new Blob([wav], { type: 'audio/wav' }));

    ws.on('decode', () => {
      regions.enableDragSelection({
        color: 'rgba(251, 191, 36, 0.18)'
      });
    });

    regions.on('region-created', (region: Region) => {
      setSlices((prev) =>
        prev.some((s) => s.id === region.id)
          ? prev
          : [...prev, { id: region.id, start: region.start, end: region.end, assigned: null }]
      );
    });
    regions.on('region-updated', (region: Region) => {
      setSlices((prev) =>
        prev.map((s) => (s.id === region.id ? { ...s, start: region.start, end: region.end } : s))
      );
    });
    regions.on('region-removed', (region: Region) => {
      setSlices((prev) => prev.filter((s) => s.id !== region.id));
    });

    return () => {
      regionsRef.current = null;
      ws.destroy();
      wsRef.current = null;
    };
  }, [source]);

  // Programmatically split source into N equal slices.
  const autoEqual = useCallback(
    (n: number): void => {
      if (!source || !regionsRef.current) return;
      regionsRef.current.clearRegions();
      setSlices([]);
      const step = source.duration / n;
      for (let i = 0; i < n; i++) {
        regionsRef.current.addRegion({
          start: i * step,
          end: (i + 1) * step,
          color: 'rgba(251, 191, 36, 0.18)',
          drag: true,
          resize: true
        });
      }
    },
    [source]
  );

  const clearSlices = useCallback(() => {
    regionsRef.current?.clearRegions();
    setSlices([]);
  }, []);

  // Assign one slice to a pad: render → save → set buffer → update bank.
  const assignSlice = useCallback(
    async (slice: Slice, padId: number): Promise<void> => {
      if (!source) return;
      const pad = useSampler.getState().bank.pads[padId];
      if (!pad) return;
      if (pad.samplePath) {
        if (!window.confirm(`Pad ${padId + 1} に既存サンプルがあります。上書きしますか?`)) return;
      }
      setBusy(true);
      try {
        const rendered = await renderEdits(source, {
          trimStart: slice.start,
          trimEnd: slice.end,
          fadeIn: 0,
          fadeOut: 0,
          gainDb: 0
        });

        const wav = encodeWav(rendered);
        const { path } = await window.sampler.samples.save({ padId, wav });

        audioEngine.setBuffer(padId, rendered);
        markPadLoaded(padId);

        const prev = pad.samplePath;
        updatePad(padId, { samplePath: path });
        if (prev && prev !== path) {
          try {
            await window.sampler.samples.delete({ path: prev });
          } catch (err) {
            console.warn('Failed to delete previous sample', err);
          }
        }
        await window.sampler.bank.write(useSampler.getState().bank);

        setSlices((prev2) =>
          prev2.map((s) => (s.id === slice.id ? { ...s, assigned: padId } : s))
        );
      } catch (err) {
        console.error('Slice assign failed', err);
        window.alert('スライスの割り当てに失敗しました。');
      } finally {
        setBusy(false);
      }
    },
    [source, markPadLoaded, updatePad]
  );

  const onClose = (): void => {
    if (recorderRef.current) recorderRef.current.cancel();
    closeChop();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl w-[860px] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Chop mode</h2>
          {source && (
            <span className="text-xs text-zinc-500 font-mono">
              source: {source.duration.toFixed(2)}s · {source.numberOfChannels}ch · {source.sampleRate}Hz
            </span>
          )}
        </header>

        <section className="flex items-center gap-3 mb-4">
          <button
            onClick={() => (recState === 'recording' ? void stopRecord() : void startRecord())}
            className={`px-4 py-2 rounded-md text-sm font-semibold ${
              recState === 'recording'
                ? 'bg-red-500 hover:bg-red-400 text-white'
                : 'bg-zinc-800 hover:bg-zinc-700'
            }`}
          >
            {recState === 'recording' ? '■ Stop' : '● Record'}
          </button>
          <LevelMeter
            active={recState === 'recording'}
            getLevel={() => recorderRef.current?.getLevel() ?? 0}
          />
          <span className="w-px h-5 bg-zinc-700 mx-1" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700"
          >
            Load WAV...
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => void onFile(e)}
          />
        </section>

        {source ? (
          <>
            <div ref={containerRef} className="rounded-md bg-zinc-950 border border-zinc-800 mb-3" />

            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs text-zinc-500">Auto:</span>
              {[2, 4, 8, 12].map((n) => (
                <button
                  key={n}
                  onClick={() => autoEqual(n)}
                  className="px-2 py-1 rounded text-xs bg-zinc-800 hover:bg-zinc-700"
                >
                  Equal × {n}
                </button>
              ))}
              <span className="w-px h-5 bg-zinc-700 mx-1" />
              <button
                onClick={clearSlices}
                className="px-2 py-1 rounded text-xs bg-zinc-800 hover:bg-zinc-700"
              >
                Clear slices
              </button>
              <span className="ml-auto text-xs text-zinc-500">
                波形上をドラッグでスライスを追加
              </span>
            </div>

            {slices.length === 0 ? (
              <div className="text-sm text-zinc-500 py-8 text-center border border-dashed border-zinc-800 rounded">
                スライスがありません。波形をドラッグで範囲指定するか Auto を使ってください。
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {[...slices]
                  .sort((a, b) => a.start - b.start)
                  .map((s, idx) => (
                    <SliceRow
                      key={s.id}
                      label={`Slice ${idx + 1}`}
                      slice={s}
                      busy={busy}
                      onAssign={(padId) => void assignSlice(s, padId)}
                    />
                  ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-zinc-500 py-12 text-center border border-dashed border-zinc-800 rounded">
            録音 or WAV 読み込みでソース音源を読み込んでください
          </div>
        )}

        <footer className="flex justify-end mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

interface SliceRowProps {
  label: string;
  slice: Slice;
  busy: boolean;
  onAssign: (padId: number) => void;
}

function SliceRow({ label, slice, busy, onAssign }: SliceRowProps) {
  return (
    <div className="flex items-center gap-3 bg-zinc-950/60 border border-zinc-800 rounded px-3 py-2">
      <div className="w-32 shrink-0">
        <div className="text-xs font-semibold text-zinc-300">{label}</div>
        <div className="text-[11px] font-mono text-zinc-500">
          {slice.start.toFixed(2)}s → {slice.end.toFixed(2)}s
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: PAD_COUNT }, (_, i) => i).map((padId) => (
          <button
            key={padId}
            onClick={() => onAssign(padId)}
            disabled={busy}
            className={`min-w-[28px] h-7 rounded text-xs font-mono disabled:opacity-40 ${
              slice.assigned === padId
                ? 'bg-emerald-500 text-zinc-950 font-semibold'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }`}
            title={`Assign to Pad ${padId + 1}`}
          >
            {padId + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
