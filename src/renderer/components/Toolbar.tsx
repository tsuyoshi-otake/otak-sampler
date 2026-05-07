import { useSampler } from '../state/store';
import { audioEngine } from '../audio/AudioEngine';
import { RecordButton } from './RecordButton';
import { hydrateBank } from '../state/hydrate';

export function Toolbar() {
  const selectedPad = useSampler((s) => s.bank.pads[s.bank.selectedPadId]);
  const loadedPadIds = useSampler((s) => s.loadedPadIds);
  const updatePad = useSampler((s) => s.updatePad);
  const openEditor = useSampler((s) => s.openEditor);
  const openChop = useSampler((s) => s.openChop);
  const markPadUnloaded = useSampler((s) => s.markPadUnloaded);

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
      </div>
    </div>
  );
}
