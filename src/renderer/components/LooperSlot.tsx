import { useCallback, useEffect, useRef, useState } from 'react';
import { useSampler } from '../state/store';
import { audioEngine } from '../audio/AudioEngine';
import type { RecorderHandle } from '../audio/recorder';
import { encodeWav } from '../audio/encodeWav';
import type { LooperSlotConfig } from '../../shared/bank-schema';

interface LooperSlotProps {
  slot: LooperSlotConfig;
}

const LOOPER_PAD_ID_OFFSET = 100;

export function LooperSlot({ slot }: LooperSlotProps) {
  const updateLooper = useSampler((s) => s.updateLooper);
  const markLoopLoaded = useSampler((s) => s.markLoopLoaded);
  const markLoopUnloaded = useSampler((s) => s.markLoopUnloaded);
  const markLoopPlaying = useSampler((s) => s.markLoopPlaying);
  const markLoopStopped = useSampler((s) => s.markLoopStopped);
  const setLooperRecordingSlot = useSampler((s) => s.setLooperRecordingSlot);

  const isLoaded = useSampler((s) => s.loopLoadedSlotIds.has(slot.id));
  const isPlaying = useSampler((s) => s.loopPlaying.has(slot.id));
  const recordingSlot = useSampler((s) => s.looperRecordingSlot);
  const padRecording = useSampler((s) => s.recording);
  const pads = useSampler((s) => s.bank.pads);
  const padLoaded = useSampler((s) => s.loadedPadIds);

  const isThisRecording = recordingSlot === slot.id;
  const otherBusy = (recordingSlot !== null && recordingSlot !== slot.id) || padRecording !== 'idle';

  const handleRef = useRef<RecorderHandle | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  const [showLoadMenu, setShowLoadMenu] = useState(false);

  useEffect(() => {
    if (!isThisRecording) return;
    startedAt.current = performance.now();
    const id = window.setInterval(() => {
      setElapsed((performance.now() - startedAt.current) / 1000);
    }, 100);
    return () => window.clearInterval(id);
  }, [isThisRecording]);

  const onPlayToggle = (): void => {
    if (!isLoaded) return;
    if (isPlaying) {
      audioEngine.stopLoop(slot.id);
      markLoopStopped(slot.id);
    } else {
      audioEngine.playLoop(slot.id, slot.gainDb);
      markLoopPlaying(slot.id);
    }
  };

  const startRec = useCallback(async (): Promise<void> => {
    if (otherBusy || isThisRecording) return;
    if (slot.samplePath) {
      const ok = window.confirm(`${slot.name} の既存ループを上書きしますか?`);
      if (!ok) return;
    }
    setLooperRecordingSlot(slot.id);
    try {
      const handle = await audioEngine.record();
      handleRef.current = handle;
    } catch (err) {
      console.error('Loop recording failed to start', err);
      setLooperRecordingSlot(null);
      window.alert('ループ録音を開始できませんでした。');
    }
  }, [otherBusy, isThisRecording, slot.id, slot.name, slot.samplePath, setLooperRecordingSlot]);

  const stopRec = useCallback(async (): Promise<void> => {
    const handle = handleRef.current;
    if (!handle) return;
    handleRef.current = null;
    try {
      // If the loop was already playing the previous take, halt before swap.
      audioEngine.stopLoop(slot.id);
      markLoopStopped(slot.id);

      const blob = await handle.stop();
      const arr = await blob.arrayBuffer();
      const audioBuffer = await audioEngine.decode(arr);
      audioEngine.setLoopBuffer(slot.id, audioBuffer);
      markLoopLoaded(slot.id);

      const wav = encodeWav(audioBuffer);
      const { path } = await window.sampler.samples.save({
        padId: LOOPER_PAD_ID_OFFSET + slot.id,
        wav
      });

      const prev = slot.samplePath;
      updateLooper(slot.id, { samplePath: path });
      if (prev && prev !== path) {
        try {
          await window.sampler.samples.delete({ path: prev });
        } catch (err) {
          console.warn('Failed to delete previous loop file', err);
        }
      }
      await window.sampler.bank.write(useSampler.getState().bank);
    } catch (err) {
      console.error('Loop recording finalize failed', err);
      window.alert('ループ録音の保存に失敗しました。');
    } finally {
      setLooperRecordingSlot(null);
      setElapsed(0);
    }
  }, [
    markLoopLoaded,
    markLoopStopped,
    setLooperRecordingSlot,
    slot.id,
    slot.samplePath,
    updateLooper
  ]);

  const onRecClick = (): void => {
    if (isThisRecording) void stopRec();
    else void startRec();
  };

  const onLoadFromPad = async (padId: number): Promise<void> => {
    setShowLoadMenu(false);
    if (slot.samplePath) {
      const ok = window.confirm(`${slot.name} を Pad ${padId + 1} で上書きしますか?`);
      if (!ok) return;
    }
    const buf = audioEngine.getBuffer(padId);
    if (!buf) {
      window.alert('そのパッドにはサンプルが入っていません。');
      return;
    }
    audioEngine.stopLoop(slot.id);
    markLoopStopped(slot.id);

    const ctx = audioEngine.context();
    const copy = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      copy.copyToChannel(buf.getChannelData(ch), ch);
    }
    audioEngine.setLoopBuffer(slot.id, copy);
    markLoopLoaded(slot.id);

    const wav = encodeWav(copy);
    try {
      const { path } = await window.sampler.samples.save({
        padId: LOOPER_PAD_ID_OFFSET + slot.id,
        wav
      });
      const prev = slot.samplePath;
      updateLooper(slot.id, { samplePath: path });
      if (prev && prev !== path) {
        try {
          await window.sampler.samples.delete({ path: prev });
        } catch (err) {
          console.warn('Failed to delete previous loop file', err);
        }
      }
      await window.sampler.bank.write(useSampler.getState().bank);
    } catch (err) {
      console.error('Failed to persist loop from pad', err);
    }
  };

  const onClear = async (): Promise<void> => {
    if (!isLoaded) return;
    if (!window.confirm(`${slot.name} をクリアしますか?`)) return;
    audioEngine.stopLoop(slot.id);
    markLoopStopped(slot.id);
    audioEngine.setLoopBuffer(slot.id, null);
    markLoopUnloaded(slot.id);
    const prev = slot.samplePath;
    updateLooper(slot.id, { samplePath: null });
    if (prev) {
      try {
        await window.sampler.samples.delete({ path: prev });
      } catch (err) {
        console.warn('Failed to delete loop file', err);
      }
    }
    await window.sampler.bank.write(useSampler.getState().bank);
  };

  const onGainChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const next = Number(e.target.value);
    updateLooper(slot.id, { gainDb: next });
  };

  const onGainCommit = (): void => {
    void window.sampler.bank.write(useSampler.getState().bank);
  };

  const playableNeighborPads = pads.filter((p) => padLoaded.has(p.id));

  return (
    <div
      className={`flex flex-col gap-2 p-3 rounded-lg border ${
        isPlaying
          ? 'border-emerald-500/60 bg-emerald-500/5'
          : 'border-zinc-700 bg-zinc-900/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-zinc-200">{slot.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          {isThisRecording ? `rec ${elapsed.toFixed(1)}s` : isLoaded ? 'loaded' : 'empty'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onPlayToggle}
          disabled={!isLoaded || isThisRecording}
          className={`flex-1 px-3 py-2 rounded text-sm font-semibold transition-colors ${
            isPlaying
              ? 'bg-emerald-500 hover:bg-emerald-400 text-zinc-900'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
        >
          {isPlaying ? '■ Stop' : '▶ Play'}
        </button>
        <button
          onClick={onRecClick}
          disabled={otherBusy && !isThisRecording}
          className={`px-3 py-2 rounded text-sm transition-colors ${
            isThisRecording
              ? 'bg-red-500 hover:bg-red-400 text-white'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
        >
          {isThisRecording ? '■ Stop rec' : '● Rec'}
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <div className="relative">
          <button
            onClick={() => setShowLoadMenu((v) => !v)}
            disabled={isThisRecording}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
          >
            Load from pad ▾
          </button>
          {showLoadMenu && (
            <div
              className="absolute left-0 bottom-full mb-1 w-44 z-10 rounded border border-zinc-700 bg-zinc-900 shadow-lg max-h-56 overflow-auto"
              onMouseLeave={() => setShowLoadMenu(false)}
            >
              {playableNeighborPads.length === 0 && (
                <div className="px-2 py-1.5 text-zinc-500 text-[11px]">No loaded pads</div>
              )}
              {playableNeighborPads.map((p) => (
                <button
                  key={p.id}
                  onClick={() => void onLoadFromPad(p.id)}
                  className="block w-full text-left px-2 py-1.5 hover:bg-zinc-800 text-zinc-200"
                >
                  Pad {p.id + 1} {p.key ? `(${p.key.toUpperCase()})` : ''}
                </button>
              ))}
            </div>
          )}
        </div>
        {isLoaded && (
          <button
            onClick={() => void onClear()}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          >
            Clear
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 text-[11px] text-zinc-400">
        Vol
        <input
          type="range"
          min={-24}
          max={6}
          step={1}
          value={slot.gainDb}
          onChange={onGainChange}
          onMouseUp={onGainCommit}
          onTouchEnd={onGainCommit}
          className="flex-1 accent-emerald-400"
          disabled={!isLoaded}
        />
        <span className="w-8 text-right tabular-nums">{slot.gainDb}dB</span>
      </label>
    </div>
  );
}
