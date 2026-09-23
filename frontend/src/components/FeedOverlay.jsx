import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Sparkles, X } from 'lucide-react';
import { showToast } from './ToastContainer';

const SWIPE_MIN_PX = 50;
const TAP_MAX_PX = 10;
const TAP_MAX_MS = 400;
const WHEEL_COOLDOWN_MS = 800;

const prefersTouch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

// Sits over the YouTube iframe while the Shorts feed is active. The iframe
// would otherwise swallow every touch, so this layer owns the gestures:
// vertical swipe / wheel / arrow keys to move through the feed, tap to toggle
// playback. That also blocks YouTube's own controls, which the feed replaces.
export default function FeedOverlay({ feed, canControl, onNext, onPrev, onTogglePlay, onStop, onChangeTopic }) {
  const gestureRef = useRef(null);
  const wheelLockedUntil = useRef(0);
  const [showHint, setShowHint] = useState(prefersTouch);

  useEffect(() => {
    if (!showHint) return;
    const timer = setTimeout(() => setShowHint(false), 4000);
    return () => clearTimeout(timer);
  }, [showHint]);

  const guarded = (action) => () => {
    if (!canControl) {
      showToast('Листать ленту может только хост', 'warning', 3000);
      return;
    }
    setShowHint(false);
    action();
  };
  const next = guarded(onNext);
  const prev = guarded(onPrev);
  const stop = guarded(onStop);
  const changeTopic = guarded(onChangeTopic);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const el = e.target;
      if (el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName)) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handlePointerDown = (e) => {
    gestureRef.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {}
  };

  const handlePointerUp = (e) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dy) > SWIPE_MIN_PX && Math.abs(dy) > Math.abs(dx)) {
      (dy < 0 ? next : prev)();
    } else if (Math.abs(dx) < TAP_MAX_PX && Math.abs(dy) < TAP_MAX_PX && Date.now() - g.t < TAP_MAX_MS) {
      onTogglePlay();
    }
  };

  const handleWheel = (e) => {
    if (Math.abs(e.deltaY) < 30 || Date.now() < wheelLockedUntil.current) return;
    wheelLockedUntil.current = Date.now() + WHEEL_COOLDOWN_MS;
    (e.deltaY > 0 ? next : prev)();
  };

  const navButton = 'flex items-center justify-center w-10 h-10 rounded-full bg-black/55 hover:bg-black/75 active:scale-90 border border-white/15 text-white backdrop-blur-md transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed';

  return (
    <>
      <div
        className="absolute inset-0 z-10 touch-none select-none cursor-pointer"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { gestureRef.current = null; }}
        onWheel={handleWheel}
        aria-hidden="true"
      />

      <div className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-2">
        <button type="button" onClick={prev} disabled={feed.index === 0} className={navButton} aria-label="Предыдущее видео" title="Предыдущее (↑)">
          <ChevronUp className="w-5 h-5" />
        </button>
        <button type="button" onClick={next} className={navButton} aria-label="Следующее видео" title="Следующее (↓)">
          <ChevronDown className="w-5 h-5" />
        </button>
      </div>

      <div className="absolute left-3 right-16 bottom-3 sm:bottom-4 z-20 pointer-events-none">
        <div className="flex items-center gap-1.5 mb-2">
          <button
            type="button"
            onClick={changeTopic}
            className="pointer-events-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/85 hover:bg-accent text-white text-[11px] font-semibold backdrop-blur-md shadow-glass transition active:scale-95 cursor-pointer"
            title="Сменить тему ленты"
          >
            <Sparkles className="w-3 h-3" />
            <span className="truncate max-w-[140px]">{feed.label}</span>
          </button>
          <button
            type="button"
            onClick={stop}
            className="pointer-events-auto flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/55 hover:bg-black/75 border border-white/15 text-gray-200 text-[11px] font-semibold backdrop-blur-md transition active:scale-95 cursor-pointer"
            aria-label="Выйти из ленты"
          >
            <X className="w-3 h-3" />
            <span>Выйти</span>
          </button>
        </div>
        {feed.current && (
          <div className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            <p className="text-white text-sm font-semibold leading-snug line-clamp-2">{feed.current.title}</p>
            <p className="text-gray-300 text-xs mt-0.5 truncate">
              {feed.current.channel} · {feed.index + 1} / {feed.total}{feed.hasMore ? '+' : ''}
            </p>
          </div>
        )}
      </div>

      {showHint && (
        <div className="absolute inset-x-0 top-1/3 z-20 flex justify-center pointer-events-none animate-fade-in">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/70 text-white text-xs font-semibold backdrop-blur-md">
            <ChevronUp className="w-4 h-4 animate-bounce" />
            <span>Свайп вверх — следующее видео</span>
          </div>
        </div>
      )}
    </>
  );
}
