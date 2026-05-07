import { useCallback, useEffect, useRef, useState } from 'react';
import { useSampler } from '../state/store';
import { audioEngine } from '../audio/AudioEngine';
import type { RecorderHandle } from '../audio/recorder';
import { encodeWav } from '../audio/encodeWav';
import { describeLoopbackError } from '../audio/loopbackError';
import { LevelMeter } from './LevelMeter';

export function RecordButton() {
  const recording = useSampler((s) => s.recording);
  const setRecording = useSampler((s) => s.setRecording);
  const selectedPadId = useSampler((s) => s.bank.selectedPadId);
  const selectedPad = useSampler((s) => s.bank.pads[s.bank.selectedPadId]);
  const updatePad = useSampler((s) => s.updatePad);
  const markPadLoaded = useSampler((s) => s.markPadLoaded);
  const bank = useSampler((s) => s.bank);

  const looperRecordingSlot = useSampler((s) => s.looperRecordingSlot);
  const looperBusy = looperRecordingSlot !== null;
  const recordingSource = useSampler((s) => s.settings.recordingSource);

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
    if (looperBusy) return;
    if (!selectedPad) return;
    if (selectedPad.samplePath) {
      const ok = window.confirm(`Pad ${selectedPadId + 1} に既存サンプルを上書きしますか?`);
      if (!ok) return;
    }
    setRecording('arming');
    try {
      const handle = await audioEngine.record(recordingSource);
      handleRef.current = handle;
      setRecording('recording');
    } catch (err) {
      console.error('Recording failed', err);
      setRecording('idle');
      window.alert(describeLoopbackError(err, '録音', recordingSource));
    }
  }, [recording, looperBusy, selectedPad, selectedPadId, setRecording, recordingSource]);

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

  const setRecordingSource = useSampler((s) => s.setRecordingSource);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center rounded-md border border-zinc-700 overflow-hidden text-xs">
        <button
          onClick={() => void setRecordingSource('loopback')}
          disabled={recording !== 'idle'}
          className={`px-2 py-1 transition-colors ${
            recordingSource === 'loopback'
              ? 'bg-zinc-700 text-zinc-100'
              : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title="PC で再生中の音声を録音"
        >
          🖥 Loopback
        </button>
        <button
          onClick={() => void setRecordingSource('mic')}
          disabled={recording !== 'idle'}
          className={`px-2 py-1 transition-colors ${
            recordingSource === 'mic'
              ? 'bg-zinc-700 text-zinc-100'
              : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title="マイクから録音"
        >
          🎤 Mic
        </button>
      </div>
      <button
        onClick={onClick}
        className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
          recording === 'recording'
            ? 'bg-red-500 hover:bg-red-400 text-white'
            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
        disabled={recording === 'arming' || (looperBusy && recording === 'idle')}
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
