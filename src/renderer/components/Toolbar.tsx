import { useState } from 'react';
import { useSampler } from '../state/store';
import { audioEngine } from '../audio/AudioEngine';
import { RecordButton } from './RecordButton';
import { hydrateBank } from '../state/hydrate';
import { OutputDeviceMenu } from './OutputDeviceMenu';
import { AboutMenu } from './AboutMenu';

export function Toolbar() {
  const selectedPad = useSampler((s) => s.bank.pads[s.bank.selectedPadId]);
  const loadedPadIds = useSampler((s) => s.loadedPadIds);
  const updatePad = useSampler((s) => s.updatePad);
  const openEditor = useSampler((s) => s.openEditor);
  const openChop = useSampler((s) => s.openChop);
  const openPiano = useSampler((s) => s.openPiano);
  const markPadUnloaded = useSampler((s) => s.markPadUnloaded);
  const deviceError = useSampler((s) => s.deviceError);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [aboutMenuOpen, setAboutMenuOpen] = useState(false);

  const onClear = async (): Promise<void> => {
    if (!selectedPad) return;
    if (!loadedPadIds.has(selectedPad.id)) return;
    if (!window.confirm(`Pad ${selectedPad.id + 1} のサンプルを削除しますか?`)) return;
    audioEngine.stop(selectedPad.id);
    audioEngine.setBuffer(selectedPad.id, null);
    markPadUnloaded(selectedPad.id);
    const prev = selectedPad.samplePath;
    updatePad(selectedPad.id, { samplePath: null });
    if (prev) {
      try {
        await window.sampler.samples.delete({ path: prev });
      } catch (err) {
        console.warn('Failed to delete sample file', err);
      }
    }
    await window.sampler.bank.write(useSampler.getState().bank);
  };

  const onExport = async (): Promise<void> => {
    try {
      const result = await window.sampler.bankIo.export();
      if (result.saved && result.path) {
        window.alert(`書き出しました:\n${result.path}`);
      }
    } catch (err) {
      console.error('Export failed', err);
      window.alert('書き出しに失敗しました。');
    }
  };

  const onImport = async (): Promise<void> => {
    if (
      !window.confirm(
        '現在のバンクを上書きしてインポートします。続行しますか?\n（既存サンプルは残ります）'
      )
    )
      return;
    try {
      const result = await window.sampler.bankIo.import();
      if (result.imported && result.bank) {
        await hydrateBank(result.bank);
        window.alert('インポートしました。');
      }
    } catch (err) {
      console.error('Import failed', err);
      window.alert('インポートに失敗しました。');
    }
  };

  const canEdit = selectedPad ? loadedPadIds.has(selectedPad.id) : false;

  return (
    <div className="flex items-center justify-between gap-4 p-4 border-b border-zinc-800 bg-zinc-900">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-zinc-400">otak-sampler</span>
      </div>
      <RecordButton />
      <div className="flex items-center gap-2">
        <button
          onClick={() => selectedPad && openEditor(selectedPad.id)}
          disabled={!canEdit}
          className="px-3 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Edit
        </button>
        <button
          onClick={() => void onClear()}
          disabled={!canEdit}
          className="px-3 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Clear
        </button>
        <button
          onClick={() => audioEngine.stopAll()}
          className="px-3 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700"
        >
          Stop all
        </button>
        <span className="w-px h-5 bg-zinc-700 mx-1" />
        <button
          onClick={openChop}
          className="px-3 py-1.5 rounded text-sm bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40"
        >
          Chop
        </button>
        <button
          onClick={openPiano}
          disabled={!canEdit}
          className="px-3 py-1.5 rounded text-sm bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Piano
        </button>
        <span className="w-px h-5 bg-zinc-700 mx-1" />
        <div className="relative">
          <button
            onClick={() => setDeviceMenuOpen((v) => !v)}
            title="Output devices"
            aria-label="Output devices"
            className={`px-2 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700 ${
              deviceError ? 'text-rose-300' : 'text-zinc-300'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {deviceMenuOpen && <OutputDeviceMenu onClose={() => setDeviceMenuOpen(false)} />}
        </div>
        <span className="w-px h-5 bg-zinc-700 mx-1" />
        <button
          onClick={() => void onExport()}
          className="px-3 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700"
        >
          Export
        </button>
        <button
          onClick={() => void onImport()}
          className="px-3 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700"
        >
          Import
        </button>
        <div className="relative">
          <button
            onClick={() => setAboutMenuOpen((v) => !v)}
            title="About"
            aria-label="About"
            className="px-2 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
          {aboutMenuOpen && <AboutMenu onClose={() => setAboutMenuOpen(false)} />}
        </div>
      </div>
    </div>
  );
}
