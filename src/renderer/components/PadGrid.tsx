import { useSampler } from '../state/store';
import { Pad } from './Pad';

export function PadGrid() {
  const pads = useSampler((s) => s.bank.pads);
  const selectedPadId = useSampler((s) => s.bank.selectedPadId);
  const loadedPadIds = useSampler((s) => s.loadedPadIds);

  return (
    <div className="grid grid-cols-4 gap-3 w-full max-w-3xl mx-auto">
      {pads.map((pad) => (
        <Pad
          key={pad.id}
          pad={pad}
          selected={pad.id === selectedPadId}
          loaded={loadedPadIds.has(pad.id)}
        />
      ))}
    </div>
  );
}
