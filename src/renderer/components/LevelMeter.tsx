import { useEffect, useRef } from 'react';

interface Props {
  active: boolean;
  getLevel: () => number;
}

export function LevelMeter({ active, getLevel }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active) {
      if (ref.current) ref.current.style.width = '0%';
      return;
    }
    let raf = 0;
    const tick = (): void => {
      const level = Math.min(1, getLevel());
      if (ref.current) ref.current.style.width = `${(level * 100).toFixed(1)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, getLevel]);

  return (
    <div className="h-2 w-40 rounded bg-zinc-800 overflow-hidden">
      <div
        ref={ref}
        className="h-full bg-emerald-400 transition-[width] duration-75"
        style={{ width: '0%' }}
      />
    </div>
  );
}
