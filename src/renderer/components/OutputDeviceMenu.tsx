import { useEffect, useRef, useState } from 'react';
import { useSampler } from '../state/store';

interface OutputDeviceMenuProps {
  onClose: () => void;
}

const SYSTEM_DEFAULT_VALUE = '__default__';
const NONE_VALUE = '__none__';

export function OutputDeviceMenu({ onClose }: OutputDeviceMenuProps) {
  const settings = useSampler((s) => s.settings);
  const setPrimary = useSampler((s) => s.setPrimaryOutputDeviceId);
  const setMonitor = useSampler((s) => s.setMonitorOutputDeviceId);
  const deviceError = useSampler((s) => s.deviceError);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [labelsUnlocked, setLabelsUnlocked] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const refresh = async (): Promise<void> => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const outs = all.filter((d) => d.kind === 'audiooutput');
      setDevices(outs);
      // If we got more than just a default-labeled entry with non-empty labels,
      // treat the full list as unlocked.
      const hasLabel = outs.some((d) => d.label && d.label.length > 0);
      const hasNonDefault = outs.some(
        (d) => d.deviceId !== 'default' && d.deviceId !== 'communications'
      );
      if (hasLabel && hasNonDefault) setLabelsUnlocked(true);
    } catch (err) {
      console.warn('enumerateDevices failed', err);
    }
  };

  useEffect(() => {
    void refresh();
    const handler = (): void => void refresh();
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  const unlockLabels = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setLabelsUnlocked(true);
      await refresh();
    } catch (err) {
      console.warn('Mic permission denied', err);
    }
  };

  const onPrimaryChange = async (e: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
    const value = e.target.value;
    await setPrimary(value === SYSTEM_DEFAULT_VALUE ? null : value);
  };

  const onMonitorChange = async (e: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
    const value = e.target.value;
    await setMonitor(value === NONE_VALUE ? null : value);
  };

  const primaryValue = settings.primaryOutputDeviceId ?? SYSTEM_DEFAULT_VALUE;
  const monitorValue = settings.monitorOutputDeviceId ?? NONE_VALUE;

  const primaryMissing =
    settings.primaryOutputDeviceId !== null &&
    !devices.some((d) => d.deviceId === settings.primaryOutputDeviceId);
  const monitorMissing =
    settings.monitorOutputDeviceId !== null &&
    !devices.some((d) => d.deviceId === settings.monitorOutputDeviceId);

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full mt-2 w-80 z-20 p-4 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl text-sm"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-zinc-100">Output devices</h3>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">
          ×
        </button>
      </div>

      {!labelsUnlocked && (
        <button
          onClick={() => void unlockLabels()}
          className="w-full mb-3 px-3 py-2 rounded text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40"
        >
          Unlock full device list
          <div className="text-[10px] text-amber-200/70 mt-0.5 font-normal">
            Grants mic permission so virtual cables (e.g. VB-Cable) appear here.
          </div>
        </button>
      )}

      <label className="block mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-zinc-400 text-xs uppercase tracking-wide">Primary output</span>
          {primaryMissing && (
            <span className="text-rose-300 text-[10px]">device disconnected</span>
          )}
        </div>
        <select
          value={primaryValue}
          onChange={(e) => void onPrimaryChange(e)}
          className="w-full px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-100"
        >
          <option value={SYSTEM_DEFAULT_VALUE}>System default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Output ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <div className="flex items-center justify-between mb-1">
          <span className="text-zinc-400 text-xs uppercase tracking-wide">Monitor output</span>
          {monitorMissing && (
            <span className="text-rose-300 text-[10px]">device disconnected</span>
          )}
        </div>
        <select
          value={monitorValue}
          onChange={(e) => void onMonitorChange(e)}
          className="w-full px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-100"
        >
          <option value={NONE_VALUE}>(none)</option>
          {devices
            .filter((d) => d.deviceId !== settings.primaryOutputDeviceId)
            .map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Output ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
        </select>
        <div className="text-[10px] text-zinc-500 mt-1">
          Optional secondary output, e.g. your speakers when Primary is a virtual cable.
        </div>
      </label>

      {deviceError && (
        <div className="mt-3 px-2 py-1.5 rounded bg-rose-500/10 border border-rose-500/40 text-rose-200 text-[11px]">
          {deviceError.channel === 'monitor'
            ? `Monitor blocked: ${deviceError.message}. Click any pad to retry.`
            : `Primary error: ${deviceError.message}`}
        </div>
      )}
    </div>
  );
}
