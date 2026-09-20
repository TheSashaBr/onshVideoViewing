import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCw, Home, AlertTriangle, Compass, ChevronDown, ChevronUp, Tv } from 'lucide-react';

export default function ErrorPage({ notFound = false, error = null, onReset = null }) {
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = useState(false);

  const handleGoHome = () => {
    if (onReset) onReset();
    navigate('/');
  };

  const handleReload = () => {
    if (onReset) onReset();
    window.location.reload();
  };

  return (
    <div className="min-h-[100dvh] w-full bg-surface flex flex-col items-center justify-center p-4 text-white relative overflow-hidden select-none">
      {/* Ambient background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-accent/15 rounded-full blur-[140px] animate-pulse"
          style={{ animationDuration: '7s' }}
        />
        <div
          className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-purple-600/10 rounded-full blur-[130px] animate-pulse"
          style={{ animationDuration: '9s' }}
        />
      </div>

      {/* Main Error Card */}
      <div className="relative z-10 w-full max-w-md bg-surface-raised/90 border border-border-medium rounded-3xl p-6 sm:p-8 shadow-glass-lg backdrop-blur-2xl text-center animate-scale-in">
        {/* Brand Header */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <img src="/onsh-logo.png" alt="onsh" className="h-7 w-auto select-none opacity-90" />
          <span className="font-extrabold text-base tracking-wider text-white">onsh</span>
        </div>

        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center border shadow-inner">
          {notFound ? (
            <div className="w-full h-full rounded-2xl bg-accent/15 border-accent/30 text-accent flex items-center justify-center shadow-glow-accent">
              <Compass className="w-8 h-8 animate-spin-slow" />
            </div>
          ) : (
            <div className="w-full h-full rounded-2xl bg-amber-500/15 border-amber-500/30 text-amber-400 flex items-center justify-center shadow-amber-950/40">
              <AlertTriangle className="w-8 h-8 animate-pulse-subtle" />
            </div>
          )}
        </div>

        {/* Title and Message */}
        <h1 className="text-xl sm:text-2xl font-bold text-white mb-2 tracking-tight">
          {notFound ? 'Комната не найдена' : 'Что-то пошло не так'}
        </h1>

        <p className="text-xs sm:text-sm text-gray-400 mb-6 leading-relaxed">
          {notFound
            ? 'Похоже, ссылка на комнату неверна, комната была закрыта или время её существования истекло.'
            : 'Произошла непредвиденная ошибка в интерфейсе. Попробуйте обновить страницу или вернуться на главную.'}
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 mb-4">
          {notFound ? (
            <button
              onClick={handleGoHome}
              className="flex items-center justify-center gap-2 py-3 px-5 bg-gradient-to-r from-accent to-indigo-600 hover:from-accent-hover hover:to-indigo-500 active:scale-[0.98] text-white font-semibold text-xs rounded-xl transition-all shadow-glow-accent cursor-pointer"
            >
              <Tv className="w-4 h-4" />
              <span>Создать комнату</span>
            </button>
          ) : (
            <button
              onClick={handleReload}
              className="flex items-center justify-center gap-2 py-3 px-5 bg-gradient-to-r from-accent to-indigo-600 hover:from-accent-hover hover:to-indigo-500 active:scale-[0.98] text-white font-semibold text-xs rounded-xl transition-all shadow-glow-accent cursor-pointer"
            >
              <RotateCw className="w-4 h-4" />
              <span>Обновить страницу</span>
            </button>
          )}

          <button
            onClick={handleGoHome}
            className="flex items-center justify-center gap-2 py-3 px-5 bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.98] text-gray-200 border border-border-subtle hover:border-border-medium font-semibold text-xs rounded-xl transition-all cursor-pointer"
          >
            <Home className="w-4 h-4 text-gray-400" />
            <span>На главную</span>
          </button>
        </div>

        {/* Technical Error Details Accordion (for error boundary) */}
        {!notFound && error && (
          <div className="mt-4 pt-4 border-t border-border-subtle text-left">
            <button
              type="button"
              onClick={() => setShowDetails(prev => !prev)}
              className="flex items-center justify-between w-full text-[11px] text-gray-400 hover:text-gray-300 py-1 transition cursor-pointer"
            >
              <span>Технические подробности ошибки</span>
              {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showDetails && (
              <pre className="mt-2 p-3 rounded-xl bg-black/60 border border-border-subtle text-[10px] text-red-300 font-mono overflow-x-auto whitespace-pre-wrap max-h-36 select-text">
                {error.toString()}
                {error.stack ? `\n\n${error.stack}` : ''}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Footer copyright / info */}
      <p className="relative z-10 text-[11px] text-gray-500 mt-6 tracking-wide">
        onsh · Синхронный просмотр видео
      </p>
    </div>
  );
}
