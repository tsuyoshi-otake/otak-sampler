import { useCallback, useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, {
  type Region
} from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { useSampler } from '../state/store';
import { audioEngine } from '../audio/AudioEngine';
import { encodeWav } from '../audio/encodeWav';
import { defaultEditOps, renderEdits, type EditOps } from '../audio/offlineRender';
import {
  ensureSession,
  separateVocals,
  type SeparationProgress
} from '../audio/dsp/vocalSeparator';

export function WaveformEditor() {
  const padId = useSampler((s) => s.editingPadId);
  const closeEditor = useSampler((s) => s.closeEditor);
  const updatePad = useSampler((s) => s.updatePad);

  if (padId === null) return null;
  return <EditorBody padId={padId} onClose={closeEditor} onPadUpdate={updatePad} />;
}

interface EditorBodyProps {
  padId: number;
  onClose: () => void;
  onPadUpdate: (padId: number, patch: { samplePath: string | null }) => void;
}

function EditorBody({ padId, onClose, onPadUpdate }: EditorBodyProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<Region | null>(null);
  const initial = audioEngine.getBuffer(padId) ?? null;
  const [buffer, setBuffer] = useState<AudioBuffer | null>(initial);

  const [ops, setOps] = useState<EditOps>(() =>
    buffer ? defaultEditOps(buffer) : { trimStart: 0, trimEnd: 0, fadeIn: 0, fadeOut: 0, gainDb: 0 }
  );
  const [busy, setBusy] = useState(false);
  const [separating, setSeparating] = useState<SeparationProgress | null>(null);
  const [previewPos, setPreviewPos] = useState<number | null>(null);
  const previewSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const previewRafRef = useRef<number>(0);

  // Re-derive default ops whenever the working buffer changes (e.g. after vocal separation).
  useEffect(() => {
    if (buffer) setOps(defaultEditOps(buffer));
  }, [buffer]);

  // Init wavesurfer.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !buffer) return;

    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container,
      waveColor: '#34d399',
      progressColor: '#10b981',
      cursorColor: '#fafafa',
      height: 140,
      normalize: true,
      plugins: [regions]
    });
    wsRef.current = ws;

    const wav = encodeWav(buffer);
    const blob = new Blob([wav], { type: 'audio/wav' });
    void ws.loadBlob(blob);

    ws.on('decode', () => {
      const region = regions.addRegion({
        start: 0,
        end: buffer.duration,
        color: 'rgba(52, 211, 153, 0.18)',
        drag: true,
        resize: true
      });
      regionRef.current = region;
      region.on('update-end', () => {
        setOps((prev) => ({
          ...prev,
          trimStart: region.start,
          trimEnd: region.end
        }));
      });
    });

    return () => {
      regionRef.current = null;
      ws.destroy();
      wsRef.current = null;
    };
  }, [buffer]);

  const stopPreview = useCallback((): void => {
    if (previewSrcRef.current) {
      try {
        previewSrcRef.current.stop();
      } catch {
        /* already stopped */
      }
      previewSrcRef.current = null;
    }
    if (previewRafRef.current) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = 0;
    }
    setPreviewPos(null);
  }, []);

  const onPreview = useCallback(async (): Promise<void> => {
    if (!buffer) return;
    if (previewSrcRef.current) {
      stopPreview();
      return;
    }
    setBusy(true);
    try {
      const rendered = await renderEdits(buffer, ops);
      const ctx = audioEngine.context();
      const src = ctx.createBufferSource();
      src.buffer = rendered;
      src.connect(ctx.destination);

      const startedAt = ctx.currentTime;
      const trimStart = ops.trimStart;
      const renderedDuration = rendered.duration;

      previewSrcRef.current = src;
      src.onended = () => {
        if (previewSrcRef.current === src) stopPreview();
      };
      src.start();

      const tick = (): void => {
        const elapsed = ctx.currentTime - startedAt;
        if (elapsed >= renderedDuration) {
          stopPreview();
          return;
        }
        setPreviewPos(trimStart + elapsed);
        previewRafRef.current = requestAnimationFrame(tick);
      };
      previewRafRef.current = requestAnimationFrame(tick);
    } finally {
      setBusy(false);
    }
  }, [buffer, ops, stopPreview]);

  // Stop preview if the editor closes or the buffer changes.
  useEffect(() => stopPreview, [stopPreview]);
  useEffect(() => {
    return () => stopPreview();
  }, [buffer, stopPreview]);

  const onSeparate = useCallback(
    async (target: 'vocals' | 'instrumental'): Promise<void> => {
      if (!buffer) return;
      setBusy(true);
      setSeparating({ phase: 'load' });
      try {
        await ensureSession('voc_ft', (p) => setSeparating(p));
        const result = await separateVocals(buffer, audioEngine.context(), (p) =>
          setSeparating(p)
        );
        setBuffer(target === 'vocals' ? result.vocals : result.instrumental);
      } catch (err) {
        console.error('Vocal separation failed', err);
        window.alert(
          'ボーカル分離に失敗しました。コンソールを確認してください。\n' + String(err)
        );
      } finally {
        setSeparating(null);
        setBusy(false);
      }
    },
    [buffer]
  );

  const onSave = useCallback(async (): Promise<void> => {
    if (!buffer) return;
    setBusy(true);
    try {
      const rendered = await renderEdits(buffer, ops);
      audioEngine.setBuffer(padId, rendered);

      const wav = encodeWav(rendered);
      const { path } = await window.sampler.samples.save({ padId, wav });

      const prev = useSampler.getState().bank.pads[padId]?.samplePath ?? null;
      onPadUpdate(padId, { samplePath: path });
      if (prev && prev !== path) {
        try {
          await window.sampler.samples.delete({ path: prev });
        } catch (err) {
          console.warn('Failed to delete previous sample', err);
        }
      }
      await window.sampler.bank.write(useSampler.getState().bank);
      onClose();
    } catch (err) {
      console.error('Save failed', err);
      window.alert('保存に失敗しました。');
    } finally {
      setBusy(false);
    }
  }, [buffer, ops, padId, onClose, onPadUpdate]);

  if (!buffer) {
    return (
      <Modal onClose={onClose}>
        <div className="text-zinc-300">No buffer loaded for pad {padId + 1}.</div>
      </Modal>
    );
  }

  const duration = buffer.duration;

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-4 w-[720px]">
        <header className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Edit pad {padId + 1}</h2>
          <span className="text-xs text-zinc-500 font-mono">
            {duration.toFixed(2)}s · {buffer.numberOfChannels}ch · {buffer.sampleRate}Hz
          </span>
        </header>

        <div className="relative rounded-md bg-zinc-950 border border-zinc-800 overflow-hidden">
          <div ref={containerRef} />
          {previewPos !== null && (
            <div
              className="absolute top-0 bottom-0 w-px bg-fuchsia-300 shadow-[0_0_8px_rgba(232,121,249,0.9)] pointer-events-none"
              style={{
                left: `${Math.min(100, Math.max(0, (previewPos / duration) * 100))}%`
              }}
            />
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Slider
            label={`Fade in: ${ops.fadeIn.toFixed(2)}s`}
            min={0}
            max={Math.max(0.001, duration / 2)}
            step={0.01}
            value={ops.fadeIn}
            onChange={(v) => setOps({ ...ops, fadeIn: v })}
          />
          <Slider
            label={`Fade out: ${ops.fadeOut.toFixed(2)}s`}
            min={0}
            max={Math.max(0.001, duration / 2)}
            step={0.01}
            value={ops.fadeOut}
            onChange={(v) => setOps({ ...ops, fadeOut: v })}
          />
          <Slider
            label={`Gain: ${ops.gainDb >= 0 ? '+' : ''}${ops.gainDb.toFixed(1)} dB`}
            min={-24}
            max={12}
            step={0.5}
            value={ops.gainDb}
            onChange={(v) => setOps({ ...ops, gainDb: v })}
          />
        </div>

        <div className="text-xs font-mono text-zinc-500">
          Trim: {ops.trimStart.toFixed(2)}s → {ops.trimEnd.toFixed(2)}s
          ({Math.max(0, ops.trimEnd - ops.trimStart).toFixed(2)}s)
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
          <span className="text-xs text-zinc-500 mr-2">Vocal AI</span>
          <button
            onClick={() => void onSeparate('vocals')}
            disabled={busy}
            className="px-3 py-1.5 rounded text-sm bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-200 border border-fuchsia-500/40 disabled:opacity-50"
          >
            Vocal isolate
          </button>
          <button
            onClick={() => void onSeparate('instrumental')}
            disabled={busy}
            className="px-3 py-1.5 rounded text-sm bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-200 border border-fuchsia-500/40 disabled:opacity-50"
          >
            Vocal cut
          </button>
          {separating && (
            <span className="text-xs text-zinc-400 ml-2">{progressLabel(separating)}</span>
          )}
        </div>

        <footer className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            onClick={() => void onPreview()}
            disabled={busy && previewPos === null}
            className="px-3 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
          >
            {previewPos !== null ? 'Stop' : 'Preview'}
          </button>
          <button
            onClick={() => void onSave()}
            disabled={busy}
            className="px-3 py-1.5 rounded text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 disabled:opacity-50"
          >
            Save
          </button>
        </footer>
      </div>
    </Modal>
  );
}

function progressLabel(p: SeparationProgress): string {
  if (p.phase === 'download') {
    const pct = p.total > 0 ? ((p.received / p.total) * 100).toFixed(0) : '?';
    const mb = (p.received / 1024 / 1024).toFixed(1);
    return `Downloading model... ${mb}MB (${pct}%)`;
  }
  if (p.phase === 'load') return 'Loading model...';
  return `Separating chunk ${p.chunk + 1}/${p.total}`;
}

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}

function Slider({ label, min, max, step, value, onChange }: SliderProps) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-400">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-emerald-400"
      />
    </label>
  );
}

interface ModalProps {
  children: React.ReactNode;
  onClose: () => void;
}

function Modal({ children, onClose }: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
