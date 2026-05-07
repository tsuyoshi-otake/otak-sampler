import { useEffect, useRef, useState } from 'react';

interface AboutMenuProps {
  onClose: () => void;
}

const RELEASES_URL = 'https://github.com/tsuyoshi-otake/otak-sampler/releases';

export function AboutMenu({ onClose }: AboutMenuProps) {
  const [version, setVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.sampler.app.version().then(setVersion);
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

  const onCheck = async (): Promise<void> => {
    setChecking(true);
    try {
      await window.sampler.updater.check();
    } finally {
      setChecking(false);
    }
  };

  const onOpenReleases = (): void => {
    void window.sampler.app.openExternal(RELEASES_URL);
  };

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full mt-2 w-64 z-20 p-4 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl text-sm"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-zinc-100">About</h3>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">
          ×
        </button>
      </div>
      <div className="text-xs text-zinc-400 mb-3">
        otak-sampler{' '}
        <span className="font-mono text-zinc-200">{version ? `v${version}` : '…'}</span>
      </div>
      <div className="flex flex-col gap-2">
        <button
          onClick={() => void onCheck()}
          disabled={checking}
          className="px-2 py-1.5 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40"
        >
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        <button
          onClick={onOpenReleases}
          className="px-2 py-1.5 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
        >
          Open releases page ↗
        </button>
      </div>
      <div className="mt-3 text-[10px] text-zinc-500 leading-relaxed">
        Auto-update fetches from GitHub Releases. The repository is private,
        so the app reads <span className="font-mono">GH_TOKEN</span> from your
        environment if set. Without a token, use the releases page link above.
      </div>
    </div>
  );
}
