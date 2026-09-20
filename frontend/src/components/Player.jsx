import { useState, useEffect } from 'react';
import { useRoomStore } from '../store/roomStore';
import { parseVideoUrl } from '../utils/urlHelper';
import YouTubePlayer from './players/YouTubePlayer';
import RutubePlayer from './players/RutubePlayer';
import TwitchPlayer from './players/TwitchPlayer';
import VKVideoPlayer from './players/VKVideoPlayer';
import DzenPlayer from './players/DzenPlayer';
import { PlayerSkeleton } from './Skeleton';
import {
  Film,
  Play,
  Link2,
  Check,
  AlertCircle,
  X,
  Lightbulb,
  Tv,
  Crown,
  CheckCircle2,
} from 'lucide-react';

const PLATFORMS = [
  {
    id: 'youtube',
    name: 'YouTube',
    color: 'text-red-400',
    border: 'border-red-500/25',
    bg: 'bg-red-500/10',
    hoverBg: 'hover:bg-red-500/20',
  },
  {
    id: 'rutube',
    name: 'Rutube',
    color: 'text-blue-400',
    border: 'border-blue-500/25',
    bg: 'bg-blue-500/10',
    hoverBg: 'hover:bg-blue-500/20',
  },
  {
    id: 'twitch',
    name: 'Twitch',
    color: 'text-purple-400',
    border: 'border-purple-500/25',
    bg: 'bg-purple-500/10',
    hoverBg: 'hover:bg-purple-500/20',
  },
  {
    id: 'vkvideo',
    name: 'VK Видео',
    color: 'text-sky-400',
    border: 'border-sky-500/25',
    bg: 'bg-sky-500/10',
    hoverBg: 'hover:bg-sky-500/20',
  },
  {
    id: 'dzen',
    name: 'Dzen',
    color: 'text-amber-400',
    border: 'border-amber-500/25',
    bg: 'bg-amber-500/10',
    hoverBg: 'hover:bg-amber-500/20',
  },
];

export default function Player() {
  const roomState = useRoomStore(state => state.roomState);
  const sendMessage = useRoomStore(state => state.sendMessage);
  const loadVideo = useRoomStore(state => state.loadVideo);
  const isHost = useRoomStore(state => state.isHost);
  const isJoining = useRoomStore(state => state.isJoining);

  const [inputUrl, setInputUrl] = useState('');
  const [error, setError] = useState(null);
  const [showUrlChanger, setShowUrlChanger] = useState(false);

  // Close URL Changer modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && showUrlChanger) {
        setShowUrlChanger(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showUrlChanger]);

  // Real-time validation of the entered URL
  const detectedPlatform = inputUrl.trim() ? parseVideoUrl(inputUrl.trim()) : null;
  const platformMeta = detectedPlatform
    ? PLATFORMS.find(p => p.id === detectedPlatform.platform)
    : null;

  const handleLoadVideo = (e) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    const parsed = parseVideoUrl(inputUrl);
    if (!parsed) {
      setError('Неподдерживаемая ссылка. Поддерживаются YouTube, Rutube, Twitch, VK Видео и Dzen.');
      return;
    }

    setError(null);
    loadVideo(parsed.url, parsed.platform);
    setInputUrl('');
  };

  const handlePlay = (position) => {
    const safePos = (typeof position === 'number' && !isNaN(position))
      ? position
      : (parseFloat(roomState.currentTime) || 0);
    sendMessage('PLAY', { position: safePos });
  };

  const handlePause = (position) => {
    const safePos = (typeof position === 'number' && !isNaN(position))
      ? position
      : (parseFloat(roomState.currentTime) || 0);
    sendMessage('PAUSE', { position: safePos });
  };

  const handleSeek = (position) => {
    sendMessage('SEEK', { position, isPlaying: roomState.isPlaying });
  };

  const handleError = (errMsg) => {
    setError(errMsg);
  };

  const parsedCurrent = parseVideoUrl(roomState.videoUrl);

  // 1. Loading Skeleton while connecting before state is confirmed
  if (isJoining && !parsedCurrent) {
    return <PlayerSkeleton />;
  }

  // 2. Empty State (Onboarding when no video has been loaded yet)
  if (!parsedCurrent) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full p-4 sm:p-6 text-center relative overflow-hidden select-none">
        {/* Ambient background glows */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-accent/10 rounded-full blur-[100px]" />
          <div className="absolute bottom-1/4 right-1/4 w-60 h-60 bg-purple-600/10 rounded-full blur-[80px]" />
        </div>

        <div className="relative z-10 bg-surface-raised/90 border border-border-subtle hover:border-border-medium transition-all p-6 sm:p-8 rounded-3xl max-w-lg w-full shadow-glass-lg backdrop-blur-xl animate-scale-in">
          {/* Glowing Film Icon Badge */}
          <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-tr from-accent/25 to-purple-500/20 border border-accent/35 flex items-center justify-center shadow-glow-accent">
            <Film className="w-7 h-7 sm:w-8 sm:h-8 text-accent" />
          </div>

          <h2 className="text-xl sm:text-2xl font-bold mb-2 text-white tracking-tight">
            Что будем смотреть?
          </h2>
          <p className="text-gray-400 text-xs sm:text-sm mb-6 max-w-sm mx-auto leading-relaxed">
            Вставьте ссылку на ролик или прямую трансляцию для совместного синхронного просмотра
          </p>

          {/* Supported platform tags */}
          <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2 mb-6">
            {PLATFORMS.map((platform) => (
              <span
                key={platform.id}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border ${platform.border} ${platform.bg} ${platform.color} transition`}
              >
                {platform.name}
              </span>
            ))}
          </div>

          {/* Video Input Form */}
          <form onSubmit={handleLoadVideo} className="flex flex-col gap-3">
            <div className="relative flex items-center">
              <span className="absolute left-3.5 text-gray-400">
                <Link2 className="w-4 h-4" />
              </span>
              <input
                type="text"
                aria-label="Ссылка на видео"
                placeholder="Вставьте ссылку на YouTube, Rutube, Twitch, VK..."
                value={inputUrl}
                onChange={(e) => {
                  setInputUrl(e.target.value);
                  if (error) setError(null);
                }}
                className="w-full bg-surface border border-border-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder-gray-500 outline-none transition"
                autoFocus
              />
              {detectedPlatform && (
                <span
                  className="absolute right-3 text-emerald-400 animate-fade-in"
                  title={`Распознано: ${platformMeta?.name || detectedPlatform.platform}`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                </span>
              )}
            </div>

            {/* Real-time recognized platform notification */}
            {detectedPlatform && platformMeta && (
              <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 py-1.5 px-3 rounded-lg animate-fade-in">
                <Check className="w-3.5 h-3.5" />
                <span>Распознана ссылка {platformMeta.name}</span>
              </div>
            )}

            {error && (
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-left flex items-start gap-2 animate-fade-in">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!inputUrl.trim()}
              aria-label="Запустить видео"
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-accent to-indigo-600 hover:from-accent-hover hover:to-indigo-500 active:scale-[0.98] text-white font-bold py-3 px-4 rounded-xl transition duration-150 shadow-glow-accent text-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Запустить видео</span>
            </button>
          </form>

          <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-gray-500">
            <Lightbulb className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />
            <span>Совет: скопируйте ссылку из адресной строки браузера или приложения</span>
          </div>
        </div>
      </div>
    );
  }

  // 2. Active Video Playback View
  return (
    <div className="w-full h-full relative group bg-black overflow-hidden flex items-center justify-center">
      {/* Floating Error Alert */}
      {error && (
        <div className="absolute top-4 inset-x-4 sm:max-w-md sm:mx-auto z-40 flex items-center justify-between gap-3 p-3 bg-red-600/95 text-white text-xs font-medium rounded-2xl shadow-xl backdrop-blur-md animate-slide-up">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-200" />
            <span className="truncate">{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="p-1 rounded-md hover:bg-white/20 transition cursor-pointer shrink-0"
            title="Закрыть"
            aria-label="Закрыть уведомление об ошибке"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Render subplayer according to platform */}
      {parsedCurrent.platform === 'youtube' && (
        <YouTubePlayer
          videoId={parsedCurrent.id}
          roomState={roomState}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onError={handleError}
        />
      )}

      {parsedCurrent.platform === 'rutube' && (
        <RutubePlayer
          videoId={parsedCurrent.id}
          roomState={roomState}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onError={handleError}
        />
      )}

      {parsedCurrent.platform === 'twitch' && (
        <TwitchPlayer
          videoId={parsedCurrent.id}
          twitchType={parsedCurrent.twitchType || 'channel'}
          roomState={roomState}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onError={handleError}
        />
      )}

      {parsedCurrent.platform === 'vkvideo' && (
        <VKVideoPlayer
          videoId={parsedCurrent.id}
          roomState={roomState}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onError={handleError}
        />
      )}

      {parsedCurrent.platform === 'dzen' && (
        <DzenPlayer
          videoId={parsedCurrent.id}
          roomState={roomState}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onError={handleError}
        />
      )}

      {/* Video controls & sync badge bar */}
      <div className="absolute bottom-3 sm:bottom-4 left-3 sm:left-4 z-20 flex items-center gap-2 select-none pointer-events-auto">
        <button
          onClick={() => setShowUrlChanger((prev) => !prev)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-raised/85 hover:bg-surface-hover active:scale-95 text-xs text-gray-200 border border-border-subtle hover:border-accent/40 rounded-full backdrop-blur-md transition shadow-glass cursor-pointer"
          title="Сменить видеоисточник"
          aria-label="Сменить видеоисточник"
        >
          <Link2 className="w-3.5 h-3.5 text-accent" />
          <span className="font-medium text-[11px] sm:text-xs">Сменить видео</span>
        </button>

        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-raised/75 border border-border-subtle rounded-full text-[11px] font-medium text-gray-300 backdrop-blur-md shadow-sm"
          title="Синхронный просмотр активен"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Синхронно</span>
        </div>

        {isHost && (
          <div
            className="hidden md:flex items-center gap-1 px-2 py-1.5 bg-amber-400/10 border border-amber-400/25 rounded-full text-[11px] font-medium text-amber-300 backdrop-blur-md shadow-sm"
            title="Вы являетесь хостом комнаты"
          >
            <Crown className="w-3 h-3 text-amber-400" />
            <span>Хост</span>
          </div>
        )}
      </div>

      {/* Change Video Slide-down Panel */}
      {showUrlChanger && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-10 sm:pt-16 p-4 animate-in fade-in duration-200"
          onClick={() => setShowUrlChanger(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="change-video-modal-title"
        >
          <div
            className="relative bg-surface-raised/95 border border-border-medium p-5 sm:p-6 rounded-3xl max-w-md w-full shadow-glass-lg backdrop-blur-xl animate-in slide-in-from-top-4 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Tv className="w-4 h-4 text-accent" />
                <h3 id="change-video-modal-title" className="text-white text-base font-bold">
                  Сменить видео
                </h3>
              </div>
              <button
                onClick={() => setShowUrlChanger(false)}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.08] transition cursor-pointer"
                title="Закрыть"
                aria-label="Закрыть окно смены видео"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Currently playing snippet */}
            {parsedCurrent && (
              <div className="mb-4 p-2.5 bg-surface/80 rounded-xl border border-border-subtle flex items-center gap-2 text-xs text-gray-300">
                <span className="text-gray-500">Сейчас:</span>
                <span className="capitalize font-semibold text-accent">
                  {parsedCurrent.platform}
                </span>
                <span className="text-gray-600">·</span>
                <span className="truncate text-gray-400 font-mono text-[11px] max-w-[200px]">
                  {roomState.videoUrl}
                </span>
              </div>
            )}

            <p className="text-gray-400 text-xs mb-3">
              Вставьте новую ссылку на YouTube, Rutube, Twitch, VK Видео или Dzen:
            </p>

            <form
              onSubmit={(e) => {
                handleLoadVideo(e);
                setShowUrlChanger(false);
              }}
              className="flex flex-col gap-3"
            >
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-gray-400">
                  <Link2 className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  placeholder="https://..."
                  aria-label="Новая ссылка на видео"
                  value={inputUrl}
                  onChange={(e) => {
                    setInputUrl(e.target.value);
                    if (error) setError(null);
                  }}
                  className="w-full bg-surface border border-border-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 rounded-xl pl-10 pr-10 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition"
                  autoFocus
                />
                {detectedPlatform && (
                  <span className="absolute right-3 text-emerald-400 animate-fade-in">
                    <CheckCircle2 className="w-4 h-4" />
                  </span>
                )}
              </div>

              {detectedPlatform && platformMeta && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 py-1.5 px-3 rounded-lg animate-fade-in">
                  <Check className="w-3.5 h-3.5" />
                  <span>Распознано: {platformMeta.name}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setShowUrlChanger(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-300 hover:text-white hover:bg-white/[0.06] rounded-xl transition cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={!inputUrl.trim()}
                  className="px-4 py-2 text-xs font-semibold bg-accent hover:bg-accent-hover text-white rounded-xl transition shadow-glow-accent disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Запустить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
