import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSampler } from '../state/store';
import { audioEngine } from '../audio/AudioEngine';

export function PianoMode() {
  const open = useSampler((s) => s.pianoOpen);
  if (!open) return null;
  return <PianoBody />;
}

// 2-row diatonic keymap addressed by KeyboardEvent.code so JIS and US layouts
// both work. Each row maps to 12 consecutive white keys: pressing the home
// row left-to-right walks up the C-major scale, top row continues the scale
// for another ~1.7 octaves. Black keys (sharps/flats) are click-only via the
// piano UI — keep computer keys diatonic so the layout matches the visual
// piano without zigzagging.
//   Home row A..\ (US) / A..] (JIS)  → C D E F G A B C D E F G  (semitones 0..19)
//   Top row  Q..] (US) / Q..[ (JIS) → A B C D E F G A B C D E  (semitones 21..40)
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24, 26, 28, 29, 31, 33, 35, 36, 38, 40];

const ORDERED_CODES = [
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyF',
  'KeyG',
  'KeyH',
  'KeyJ',
  'KeyK',
  'KeyL',
  'Semicolon',
  'Quote',
  'Backslash',
  'KeyQ',
  'KeyW',
  'KeyE',
  'KeyR',
  'KeyT',
  'KeyY',
  'KeyU',
  'KeyI',
  'KeyO',
  'KeyP',
  'BracketLeft',
  'BracketRight'
] as const;

const CODE_MAP: Record<string, number> = Object.fromEntries(
  ORDERED_CODES.map((code, i) => [code, WHITE_SEMITONES[i] ?? 0])
);

// US-keyboard fallback labels for each code, used when the layout map API
// is not available. JIS labels (`:`, `]`, `@`, `[`) are derived at runtime
// from `navigator.keyboard.getLayoutMap()` when supported.
const FALLBACK_LABELS: Record<string, string> = {
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  KeyF: 'F',
  KeyG: 'G',
  KeyH: 'H',
  KeyJ: 'J',
  KeyK: 'K',
  KeyL: 'L',
  Semicolon: ';',
  Quote: "'",
  Backslash: '\\',
  KeyQ: 'Q',
  KeyW: 'W',
  KeyE: 'E',
  KeyR: 'R',
  KeyT: 'T',
  KeyY: 'Y',
  KeyU: 'U',
  KeyI: 'I',
  KeyO: 'O',
  KeyP: 'P',
  BracketLeft: '[',
  BracketRight: ']'
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

function midiToName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[midi % 12];
  return `${name}${octave}`;
}

interface KeyDef {
  midi: number;
  isBlack: boolean;
  computerKey: string | null;
}

function buildKeyboard(
  rootNote: number,
  octaveShift: number,
  labels: Record<string, string>
): KeyDef[] {
  // Cover the full mapped range (0..40 semitones from root) so every mapped
  // computer key is visible. 41 chromatic notes ≈ 25 white + 16 black.
  const baseMidi = rootNote + octaveShift * 12;
  const notes: KeyDef[] = [];
  for (let i = 0; i <= 40; i++) {
    const midi = baseMidi + i;
    const offset = midi - baseMidi;
    const code = Object.entries(CODE_MAP).find(([, idx]) => idx === offset)?.[0];
    const computerKey = code ? (labels[code] ?? FALLBACK_LABELS[code] ?? null) : null;
    const semitoneOfOctave = ((midi % 12) + 12) % 12;
    const isBlack = [1, 3, 6, 8, 10].includes(semitoneOfOctave);
    notes.push({ midi, isBlack, computerKey });
  }
  return notes;
}

function PianoBody() {
  const closePiano = useSampler((s) => s.closePiano);
  const pads = useSampler((s) => s.bank.pads);
  const loadedPadIds = useSampler((s) => s.loadedPadIds);
  const selectedPadId = useSampler((s) => s.bank.selectedPadId);

  const playablePads = pads.filter((p) => loadedPadIds.has(p.id));
  const initialPadId =
    loadedPadIds.has(selectedPadId)
      ? selectedPadId
      : (playablePads[0]?.id ?? null);

  const [sourcePadId, setSourcePadId] = useState<number | null>(initialPadId);
  const [rootNote, setRootNote] = useState(60);
  const [octaveShift, setOctaveShift] = useState(0);
  const [activeMidis, setActiveMidis] = useState<Set<number>>(new Set());
  const [keyLabels, setKeyLabels] = useState<Record<string, string>>(FALLBACK_LABELS);

  useEffect(() => {
    type KeyboardLayoutMap = { get(code: string): string | undefined; forEach(cb: (v: string, k: string) => void): void };
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<KeyboardLayoutMap> } }).keyboard;
    if (!kb?.getLayoutMap) return;
    let cancelled = false;
    void kb.getLayoutMap().then((map) => {
      if (cancelled) return;
      const next: Record<string, string> = { ...FALLBACK_LABELS };
      for (const code of Object.keys(CODE_MAP)) {
        const v = map.get(code);
        if (v) next[code] = v.toUpperCase();
      }
      setKeyLabels(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const voicesRef = useRef<Map<number, { stop: () => void }>>(new Map());
  const sourcePadIdRef = useRef<number | null>(initialPadId);
  const rootNoteRef = useRef(rootNote);
  const octaveShiftRef = useRef(octaveShift);

  useEffect(() => {
    sourcePadIdRef.current = sourcePadId;
  }, [sourcePadId]);
  useEffect(() => {
    rootNoteRef.current = rootNote;
  }, [rootNote]);
  useEffect(() => {
    octaveShiftRef.current = octaveShift;
  }, [octaveShift]);

  const triggerNote = useCallback((midi: number): void => {
    const padId = sourcePadIdRef.current;
    if (padId === null) return;
    if (voicesRef.current.has(midi)) return;
    const semitones = midi - rootNoteRef.current;
    const handle = audioEngine.playNote(padId, semitones);
    voicesRef.current.set(midi, handle);
    setActiveMidis((prev) => {
      if (prev.has(midi)) return prev;
      const next = new Set(prev);
      next.add(midi);
      return next;
    });
  }, []);

  const releaseNote = useCallback((midi: number): void => {
    const handle = voicesRef.current.get(midi);
    if (handle) {
      handle.stop();
      voicesRef.current.delete(midi);
    }
    setActiveMidis((prev) => {
      if (!prev.has(midi)) return prev;
      const next = new Set(prev);
      next.delete(midi);
      return next;
    });
  }, []);

  // Computer-key listeners.
  useEffect(() => {
    const onDown = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const target = document.activeElement as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
      }
      if (e.code === 'Escape') {
        closePiano();
        return;
      }
      if (e.code === 'KeyZ') {
        setOctaveShift((v) => Math.max(-3, v - 1));
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyX') {
        setOctaveShift((v) => Math.min(3, v + 1));
        e.preventDefault();
        return;
      }
      const idx = CODE_MAP[e.code];
      if (idx === undefined) return;
      e.preventDefault();
      const midi = rootNoteRef.current + octaveShiftRef.current * 12 + idx;
      triggerNote(midi);
    };
    const onUp = (e: KeyboardEvent): void => {
      const idx = CODE_MAP[e.code];
      if (idx === undefined) return;
      const midi = rootNoteRef.current + octaveShiftRef.current * 12 + idx;
      releaseNote(midi);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      voicesRef.current.forEach((v) => v.stop());
      voicesRef.current.clear();
    };
  }, [closePiano, triggerNote, releaseNote]);

  const keys = useMemo(
    () => buildKeyboard(rootNote, octaveShift, keyLabels),
    [rootNote, octaveShift, keyLabels]
  );
  const whiteKeys = keys.filter((k) => !k.isBlack);
  const whiteWidth = 100 / whiteKeys.length;

  const sourcePad = sourcePadId !== null ? pads[sourcePadId] : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={closePiano}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl w-[1200px] max-w-[95vw] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-zinc-100">Piano</h2>
          <button onClick={closePiano} className="text-zinc-500 hover:text-zinc-300 text-xl">
            ×
          </button>
        </div>

        <div className="flex items-center gap-4 mb-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-zinc-400">Source pad</span>
            <select
              value={sourcePadId ?? ''}
              onChange={(e) =>
                setSourcePadId(e.target.value === '' ? null : Number(e.target.value))
              }
              className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-100"
            >
              {playablePads.length === 0 && <option value="">(no loaded pads)</option>}
              {playablePads.map((p) => (
                <option key={p.id} value={p.id}>
                  Pad {p.id + 1} {p.key ? `(${p.key.toUpperCase()})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-zinc-400">Root</span>
            <select
              value={rootNote}
              onChange={(e) => setRootNote(Number(e.target.value))}
              className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-100"
            >
              {Array.from({ length: 36 }, (_, i) => 36 + i).map((midi) => (
                <option key={midi} value={midi}>
                  {midiToName(midi)} ({midi})
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-2">
            <span className="text-zinc-400">Octave</span>
            <button
              onClick={() => setOctaveShift((v) => Math.max(-3, v - 1))}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            >
              − (Z)
            </button>
            <span className="font-mono w-8 text-center">{octaveShift >= 0 ? `+${octaveShift}` : octaveShift}</span>
            <button
              onClick={() => setOctaveShift((v) => Math.min(3, v + 1))}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            >
              + (X)
            </button>
          </div>

          {sourcePad && (
            <span className="text-xs text-zinc-500">
              Playing {sourcePad.name} pitched ±semitones from {midiToName(rootNote)}.
            </span>
          )}
        </div>

        <div className="relative h-44 select-none">
          <div className="absolute inset-0 flex">
            {whiteKeys.map((k) => {
              const active = activeMidis.has(k.midi);
              const isRoot = k.midi === rootNote;
              return (
                <button
                  key={k.midi}
                  onMouseDown={() => triggerNote(k.midi)}
                  onMouseUp={() => releaseNote(k.midi)}
                  onMouseLeave={() => releaseNote(k.midi)}
                  style={{ width: `${whiteWidth}%` }}
                  className={`relative h-full border-l border-zinc-700 first:border-l-0 flex flex-col justify-end items-center pb-2 transition-colors ${
                    active
                      ? 'bg-emerald-300 text-zinc-900'
                      : isRoot
                        ? 'bg-zinc-100 text-zinc-900'
                        : 'bg-zinc-50 text-zinc-700 hover:bg-zinc-200'
                  }`}
                >
                  {k.computerKey && (
                    <span className="text-[10px] font-mono uppercase opacity-70">
                      {k.computerKey === ';' ? ';' : k.computerKey === "'" ? "'" : k.computerKey}
                    </span>
                  )}
                  <span className="text-[10px] font-mono opacity-60">{midiToName(k.midi)}</span>
                </button>
              );
            })}
          </div>
          <div className="absolute top-0 left-0 right-0 h-[60%] flex pointer-events-none">
            {whiteKeys.map((wk, i) => {
              const next = whiteKeys[i + 1];
              if (!next) return <div key={wk.midi} style={{ width: `${whiteWidth}%` }} />;
              const blackBetween = keys.find(
                (k) => k.isBlack && k.midi > wk.midi && k.midi < next.midi
              );
              return (
                <div
                  key={wk.midi}
                  style={{ width: `${whiteWidth}%` }}
                  className="relative"
                >
                  {blackBetween && (
                    <button
                      onMouseDown={() => triggerNote(blackBetween.midi)}
                      onMouseUp={() => releaseNote(blackBetween.midi)}
                      onMouseLeave={() => releaseNote(blackBetween.midi)}
                      className={`pointer-events-auto absolute top-0 h-full text-[10px] font-mono flex flex-col items-center justify-end pb-1 rounded-b transition-colors border border-zinc-950 ${
                        activeMidis.has(blackBetween.midi)
                          ? 'bg-emerald-500 text-zinc-900'
                          : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                      }`}
                      style={{
                        right: `-${whiteWidth * 0.3}%`,
                        width: `${whiteWidth * 0.6}%`
                      }}
                    >
                      {blackBetween.computerKey && (
                        <span className="opacity-80 uppercase">{blackBetween.computerKey}</span>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-3 text-[11px] text-zinc-500 leading-relaxed">
          Home row (A〜{keyLabels.Backslash ?? '\\'}) = 12 white keys ascending from root.
          Top row (Q〜{keyLabels.BracketRight ?? ']'}) = the next 12 white keys.
          Click black keys with the mouse to play sharps. Z / X shift the whole keyboard ±octave. Esc closes.
        </div>
      </div>
    </div>
  );
}
