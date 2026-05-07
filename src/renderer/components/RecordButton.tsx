import { useCallback, useEffect, useRef, useState } from 'react';
import { useSampler } from '../state/store';
import { audioEngine } from '../audio/AudioEngine';
import type { RecorderHandle } from '../audio/recorder';
import { encodeWav } from '../audio/encodeWav';
import { LevelMeter } from './LevelMeter';

export function RecordButton() {
  const recording = useSampler((s) => s.recording);
  const setRecording = useSampler((s) => s.setRecording);
  const selectedPadId = useSampler((s) => s.bank.selectedPadId);
  const selectedPad = useSampler((s) => s.bank.pads[s.bank.selectedPadId]);
  const updatePad = useSampler((s) => s.updatePad);
  const markPadLoaded = useSampler((s) => s.markPadLoaded);
  const bank = useSampler((s) => s.bank);

  const handleRef = useRef<RecorderHandle | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (recording !== 'recording') return;
    startedAt.current = performance.now();
    const id = window.setInterval(() => {
      setElapsed((performance.now() - startedAt.current) / 1000);
    }, 100);
    return () => window.clearInterval(id);
  }, [recording]);

  const start = useCallback(async (): Promise<void> => {
    if (recording !== 'idle') return;
    if (!selectedPad) return;
    if (selectedPad.samplePath) {
      const ok = window.confirm(`Pad ${selectedPadId + 1} に既存サンプルを上書きしますか?`);
      if (!ok) return;
    }
    setRecording('arming');
    try {
      const handle = await audioEngine.record();
      handleRef.current = handle;
      setRecording('recording');
    } catch (err) {
      console.error('Loopback recording failed', err);
      setRecording('idle');
      window.alert('録音を開始できませんでした。ループバックを許可してください。');
    }
  }, [recording, selectedPad, selectedPadId, setRecording]);

  const stop = useCallback(async (): Promise<void> => {
    const handle = handleRef.current;
    if (!handle) return;
    handleRef.current = null;
    try {
      const blob = await handle.stop();
      const arr = await blob.arrayBuffer();
      const audioBuffer = await audioEngine.decode(arr);
      audioEngine.setBuffer(selectedPadId, audioBuffer);
      markPadLoaded(selectedPadId);

      const wav = encodeWav(audioBuffer);
      const { path } = await window.sampler.samples.save({ padId: selectedPadId, wav });

      // Delete the previously linked file (if any) to avoid orphans.
      const prev = selectedPad?.samplePath;
      updatePad(selectedPadId, { samplePath: path });
      if (prev && prev !== path) {
        try {
          await window.sampler.samples.delete({ path: prev });
        } catch (err) {
          console.warn('Failed to delete previous sample', err);
        }
      }
      // Persist the bank.
      const next = useSampler.getState().bank;
      await window.sampler.bank.write(next);
    } catch (err) {
      console.error('Recording finalize failed', err);
      window.alert('録音の保存に失敗しました。');
    } finally {
      setRecording('idle');
      setElapsed(0);
    }
  }, [markPadLoaded, selectedPad, selectedPadId, setRecording, updatePad]);

  // bank dependency keeps the closure type-checked; not used directly here.
  void bank;

  const onClick = (): void => {
    if (recording === 'recording') void stop();
    else void start();
  };

  const label =
    recording === 'recording'
      ? `■ Stop (${elapsed.toFixed(1)}s)`
      : recording === 'arming'
        ? '...'
        : '● Record';

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onClick}
        className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
          recording === 'recording'
            ? 'bg-red-500 hover:bg-red-400 text-white'
            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100'
        }`}
        disabled={recording === 'arming'}
      >
        {label}
      </button>
      <LevelMeter
        active={recording === 'recording'}
        getLevel={() => handleRef.current?.getLevel() ?? 0}
      />
      <span className="text-xs text-zinc-500">
        Pad {selectedPadId + 1} に録音
      </span>
    </div>
  );
}
