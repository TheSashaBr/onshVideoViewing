import { useEffect, useState, useRef } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '../utils/cn';

const TOAST_ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const TOAST_STYLES = {
  success: {
    container: 'border-emerald-500/35 bg-surface-raised/95 text-gray-100 shadow-glass',
    iconWrapper: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    bar: 'bg-emerald-500',
    glow: 'shadow-glow-voice',
  },
  error: {
    container: 'border-red-500/35 bg-surface-raised/95 text-gray-100 shadow-glass',
    iconWrapper: 'bg-red-500/15 text-red-400 border border-red-500/30',
    bar: 'bg-red-500',
    glow: 'shadow-red-950/50',
  },
  warning: {
    container: 'border-amber-500/35 bg-surface-raised/95 text-gray-100 shadow-glass',
    iconWrapper: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    bar: 'bg-amber-500',
    glow: 'shadow-amber-950/50',
  },
  info: {
    container: 'border-accent/35 bg-surface-raised/95 text-gray-100 shadow-glass',
    iconWrapper: 'bg-accent/15 text-accent-hover border border-accent/30',
    bar: 'bg-accent',
    glow: 'shadow-glow-accent',
  },
};

export default function Toast({ message, type = 'info', duration = 3000, onClose }) {
  const [visible, setVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(100);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const touchStartRef = useRef({ x: 0, y: 0 });
  const remainingTimeRef = useRef(duration);
  const startTimeRef = useRef(Date.now());
  const timerRef = useRef(null);

  const style = TOAST_STYLES[type] || TOAST_STYLES.info;
  const Icon = TOAST_ICONS[type] || TOAST_ICONS.info;

  // Fade-in animation on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => onClose?.(), 250);
  };

  // Timer and progress countdown with pause support on hover/touch
  useEffect(() => {
    if (isPaused) return;

    startTimeRef.current = Date.now();
    const interval = 20;

    const intervalId = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const currentRemaining = Math.max(0, remainingTimeRef.current - elapsed);
      setProgress((currentRemaining / duration) * 100);

      if (currentRemaining <= 0) {
        clearInterval(intervalId);
        handleDismiss();
      }
    }, interval);

    return () => {
      clearInterval(intervalId);
      remainingTimeRef.current = Math.max(
        0,
        remainingTimeRef.current - (Date.now() - startTimeRef.current)
      );
    };
  }, [isPaused, duration]);

  // Mobile touch gestures: swipe up or sideways to dismiss
  const handleTouchStart = (e) => {
    setIsPaused(true);
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchMove = (e) => {
    const dx = e.touches[0].clientX - touchStartRef.current.x;
    const dy = e.touches[0].clientY - touchStartRef.current.y;
    // Allow dragging upwards or horizontally
    if (dy < 10 || Math.abs(dx) > 10) {
      setDragOffset({ x: dx, y: Math.min(dy, 10) });
    }
  };

  const handleTouchEnd = () => {
    setIsPaused(false);
    // Dismiss if swiped up > 35px or sideways > 55px
    if (dragOffset.y < -35 || Math.abs(dragOffset.x) > 55) {
      handleDismiss();
    } else {
      setDragOffset({ x: 0, y: 0 });
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        transition: dragOffset.x === 0 && dragOffset.y === 0 ? 'transform 0.2s ease, opacity 0.25s ease' : 'none',
      }}
      className={cn(
        'pointer-events-auto relative flex items-center gap-3 w-full max-w-sm sm:max-w-md py-2.5 px-3.5 rounded-2xl border backdrop-blur-xl transition-all duration-200 select-none overflow-hidden',
        style.container,
        visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
        (dragOffset.x !== 0 || dragOffset.y !== 0) && 'opacity-90'
      )}
    >
      {/* Type Icon */}
      <div className={cn('w-7 h-7 rounded-xl flex items-center justify-center shrink-0 shadow-sm', style.iconWrapper)}>
        <Icon className="w-4 h-4" />
      </div>

      {/* Message Text */}
      <p className="flex-1 text-xs font-medium text-gray-100 leading-snug break-words">
        {message}
      </p>

      {/* Close Button */}
      <button
        onClick={handleDismiss}
        aria-label="Закрыть уведомление"
        className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.08] active:scale-90 transition shrink-0 cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      {/* Animated progress bar indicator at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/[0.06]">
        <div
          className={cn('h-full transition-all ease-linear', style.bar)}
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>
    </div>
  );
}
