import { useState, useEffect, useRef, useCallback } from 'react';
import { useRoomStore } from '../store/roomStore';
import { useVoiceStore } from '../store/voiceStore';
import { parseVideoUrl } from '../utils/urlHelper';
import YouTubePlayer from './players/YouTubePlayer';
import RutubePlayer from './players/RutubePlayer';
import TwitchPlayer from './players/TwitchPlayer';
import VKVideoPlayer from './players/VKVideoPlayer';
import DzenPlayer from './players/DzenPlayer';
import LocalStreamPlayer from './players/LocalStreamPlayer';
import { PlayerSkeleton } from './Skeleton';
import { showToast } from './ToastContainer';
import { cn } from '../utils/cn';
import {
  ClipboardPaste,
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
  Lock,
  RefreshCw,
  ListVideo,
  ListPlus,
  SkipForward,
  Trash2,
  Smile,
  MonitorUp,
} from 'lucide-react';

const QUICK_REACTIONS = ['🍿', '🔥', '😂', '❤️', '👍', '😮', '👏', '🎬'];

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

const canReadClipboard = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;
// On touch devices an autofocused field pops the on-screen keyboard over the
// very buttons the user needs next (Вставить / Запустить), so skip it there.
const prefersTouch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

function VideoUrlInput({ value, onChange, detectedName, placeholder, ariaLabel, className }) {
  const handlePaste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        onChange(text);
      } else {
        showToast('Буфер обмена пуст', 'info', 2000);
      }
    } catch (e) {
      showToast('Нет доступа к буферу обмена — вставьте ссылку вручную', 'warning', 3000);
    }
  };

  const showPaste = canReadClipboard && !value;

  return (
    <div className="relative flex items-center">
      <span className="absolute left-3.5 text-gray-400">
        <Link2 className="w-4 h-4" />
      </span>
      <input
        type="text"
        inputMode="url"
        enterKeyHint="go"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        autoFocus={!prefersTouch}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full bg-surface border border-border-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 rounded-xl pl-10 text-sm text-white placeholder-gray-500 outline-none transition',
          showPaste ? 'pr-28' : 'pr-10',
          className
        )}
      />
      {showPaste ? (
        <button
          type="button"
          onClick={handlePaste}
          aria-label="Вставить ссылку из буфера обмена"
          className="absolute right-1.5 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent/15 hover:bg-accent/25 active:scale-95 border border-accent/30 text-accent text-xs font-semibold transition cursor-pointer"
        >
          <ClipboardPaste className="w-3.5 h-3.5" />
          <span>Вставить</span>
        </button>
      ) : detectedName ? (
        <span className="absolute right-3 text-emerald-400 animate-fade-in" title={`Распознано: ${detectedName}`}>
          <CheckCircle2 className="w-4 h-4" />
        </span>
      ) : null}
    </div>
  );
}

export default function Player() {
  const roomState = useRoomStore(state => state.roomState);
  const sendMessage = useRoomStore(state => state.sendMessage);
  const loadVideo = useRoomStore(state => state.loadVideo);
  const isHost = useRoomStore(state => state.isHost);
  const isJoining = useRoomStore(state => state.isJoining);
  const userId = useRoomStore(state => state.userId);
  const queue = useRoomStore(state => state.queue);
  const addToQueue = useRoomStore(state => state.addToQueue);
  const removeFromQueue = useRoomStore(state => state.removeFromQueue);
  const playNextFromQueue = useRoomStore(state => state.playNextFromQueue);
  const lastReaction = useRoomStore(state => state.lastReaction);
  const sendReaction = useRoomStore(state => state.sendReaction);
  const members = useRoomStore(state => state.members);

  const isScreenSharing = useVoiceStore(state => state.isScreenSharing);
  const isStreamConnecting = useVoiceStore(state => state.isStreamConnecting);
  const startScreenShare = useVoiceStore(state => state.startScreenShare);
  const stopScreenShare = useVoiceStore(state => state.stopScreenShare);

  // If the room state moves away from "local-stream" while we're still
  // publishing (e.g. the host force-ended our stream, or someone loaded a
  // new video from another tab), stop actually transmitting too — otherwise
  // we'd keep publishing to LiveKit in the background for nothing.
  useEffect(() => {
    if (isScreenSharing && roomState.videoType !== 'local-stream') {
      stopScreenShare();
    }
  }, [isScreenSharing, roomState.videoType, stopScreenShare]);

  const [inputUrl, setInputUrl] = useState('');
  const [error, setError] = useState(null);
  const [showUrlChanger, setShowUrlChanger] = useState(false);
  const [localTime, setLocalTime] = useState(null);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState([]);

  const activePlayerRef = useRef(null);

  const controlMode = roomState.controlMode === 'host' ? 'host' : 'anyone';
  const canControl = controlMode !== 'host' || isHost;

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

  // Reset the drift tracker whenever the loaded video changes — a fresh video
  // has no meaningful "local time" to compare against yet.
  useEffect(() => {
    setLocalTime(null);
  }, [roomState.videoUrl]);

  const handleTimeUpdate = useCallback((t) => {
    if (typeof t === 'number' && !isNaN(t)) setLocalTime(t);
  }, []);

  // Spawn a floating emoji whenever a reaction arrives (own or remote); each
  // one removes itself once its rise-and-fade animation finishes.
  useEffect(() => {
    if (!lastReaction) return;
    const left = 15 + Math.random() * 70; // percent, keeps it away from the edges
    setFloatingReactions(prev => [...prev, { ...lastReaction, left }]);
    const timer = setTimeout(() => {
      setFloatingReactions(prev => prev.filter(r => r.id !== lastReaction.id));
    }, 2500);
    return () => clearTimeout(timer);
  }, [lastReaction]);

  const handleSendReaction = (emoji) => {
    sendReaction(emoji);
    setShowReactionPicker(false);
  };

  // Expected position derived from server state (same formula every player uses internally)
  let expectedTime = parseFloat(roomState.currentTime || 0);
  if (roomState.isPlaying && roomState.lastUpdatedAt) {
    const elapsed = (Date.now() - roomState.lastUpdatedAt) / 1000;
    expectedTime += Math.max(0, elapsed * parseFloat(roomState.playbackRate || 1.0));
  }
  const drift = (roomState.isPlaying && localTime != null) ? Math.abs(localTime - expectedTime) : 0;
  const showDriftBadge = drift > 2;

  const handleResync = () => {
    if (activePlayerRef.current?.seekLocal) {
      activePlayerRef.current.seekLocal(expectedTime);
      setLocalTime(expectedTime);
      showToast('Синхронизировано с комнатой', 'success', 2000);
    }
  };

  // Real-time validation of the entered URL
  const detectedPlatform = inputUrl.trim() ? parseVideoUrl(inputUrl.trim()) : null;
  const platformMeta = detectedPlatform
    ? PLATFORMS.find(p => p.id === detectedPlatform.platform)
    : null;

  const handleUrlChange = (value) => {
    setInputUrl(value);
    if (error) setError(null);
  };

  const handleLoadVideo = (e) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    if (!canControl) {
      setError('Изменение видео доступно только хосту комнаты.');
      return;
    }

    const parsed = parseVideoUrl(inputUrl);
    if (!parsed) {
      setError('Неподдерживаемая ссылка. Поддерживаются YouTube, Rutube, Twitch, VK Видео и Dzen.');
      return;
    }

    setError(null);
    loadVideo(parsed.url, parsed.platform);
    setInputUrl('');
  };

  const handleAddToQueue = () => {
    if (!inputUrl.trim()) return;

    if (!canControl) {
      setError('Добавление в очередь доступно только хосту комнаты.');
      return;
    }

    const parsed = parseVideoUrl(inputUrl);
    if (!parsed) {
      setError('Неподдерживаемая ссылка. Поддерживаются YouTube, Rutube, Twitch, VK Видео и Dzen.');
      return;
    }

    setError(null);
    addToQueue(parsed.url, parsed.platform);
    setInputUrl('');
    showToast('Добавлено в очередь', 'success', 2000);
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

  // Auto-advance to the next queued video when the current one ends. Only
  // wired for YouTube for now — the other platforms' embeds don't expose a
  // reliable "ended" signal over postMessage, so elsewhere it's manual-only
  // via the "Далее" button.
  const handleEnded = () => {
    if (canControl && queue.length > 0) {
      playNextFromQueue();
    }
  };

  const isLocalStream = roomState.videoType === 'local-stream';
  const parsedCurrent = isLocalStream ? null : parseVideoUrl(roomState.videoUrl);

  const handleStartScreenShare = () => {
    if (!canControl) {
      showToast('Транслировать экран может только хост', 'warning', 3000);
      return;
    }
    startScreenShare();
    setShowUrlChanger(false);
  };

  // 1. Loading Skeleton while connecting before state is confirmed
  if (isJoining && !parsedCurrent && !isLocalStream) {
    return <PlayerSkeleton />;
  }

  // 1b. Local video/screen stream — a live WebRTC relay, not a seekable embed
  if (isLocalStream) {
    const isOwner = !!roomState.videoOwnerId && String(roomState.videoOwnerId) === String(userId);
    const owner = members.find(m => String(m.userId) === String(roomState.videoOwnerId));
    return (
      <div className="w-full h-full relative bg-black overflow-hidden flex items-center justify-center">
        <LocalStreamPlayer
          isOwner={isOwner}
          ownerNickname={owner?.nickname}
          onDismissEnded={canControl ? () => loadVideo('', 'youtube') : undefined}
        />

        {/* Floating video reactions */}
        <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden">
          {floatingReactions.map((r) => (
            <span
              key={r.id}
              className="absolute bottom-16 text-4xl animate-float-up select-none"
              style={{ left: `${r.left}%` }}
            >
              {r.emoji}
            </span>
          ))}
        </div>

        <div className="absolute bottom-16 md:bottom-4 right-3 sm:right-4 z-20 select-none pointer-events-auto">
          {showReactionPicker && (
            <div className="mb-2 flex items-center gap-1 p-1.5 bg-surface-raised/95 border border-border-medium rounded-full backdrop-blur-md shadow-glass animate-scale-in">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleSendReaction(emoji)}
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/[0.08] hover:scale-115 active:scale-90 transition text-base cursor-pointer"
                  aria-label={`Отправить реакцию ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowReactionPicker((prev) => !prev)}
            className="flex items-center justify-center w-10 h-10 bg-surface-raised/85 hover:bg-surface-hover active:scale-95 text-gray-200 border border-border-subtle hover:border-accent/40 rounded-full backdrop-blur-md transition shadow-glass cursor-pointer ml-auto"
            title="Отправить реакцию"
            aria-label={showReactionPicker ? 'Закрыть панель реакций' : 'Открыть панель реакций'}
            aria-expanded={showReactionPicker}
          >
            <Smile className="w-4 h-4" />
          </button>
        </div>

        <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-600/90 border border-red-400/40 rounded-full text-[11px] font-bold text-white backdrop-blur-md shadow-sm"
            title="Прямая трансляция — без перемотки"
          >
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span>Прямой эфир</span>
          </div>

          {/* Host moderation: force-end someone else's stream if needed. This
              only clears the shared room state — the presenter's own browser
              keeps publishing until they close the tab or stop manually. */}
          {isHost && roomState.videoOwnerId && String(roomState.videoOwnerId) !== String(userId) && (
            <button
              onClick={() => loadVideo('', 'youtube')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-raised/90 hover:bg-surface-hover border border-border-subtle rounded-full text-[11px] font-semibold text-gray-200 backdrop-blur-md shadow-sm transition cursor-pointer"
              title="Завершить трансляцию для всех"
            >
              <span>Завершить трансляцию</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // 2. Empty State (Onboarding when no video has been loaded yet)
  if (!parsedCurrent) {
    return (
      // Scrolls instead of clipping when the form is taller than the space
      // (my-auto on the card keeps it centred whenever it does fit).
      <div className="flex flex-col items-center h-full w-full p-3 sm:p-6 text-center relative overflow-y-auto select-none">
        {/* Ambient background glows */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-accent/10 rounded-full blur-[100px]" />
          <div className="absolute bottom-1/4 right-1/4 w-60 h-60 bg-purple-600/10 rounded-full blur-[80px]" />
        </div>

        <div className="relative z-10 my-auto bg-surface-raised/90 border border-border-subtle hover:border-border-medium transition-all p-4 sm:p-8 rounded-2xl sm:rounded-3xl max-w-lg w-full shadow-glass-lg backdrop-blur-xl animate-scale-in">
          {/* Glowing Film Icon Badge */}
          <div className="hidden sm:flex w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-tr from-accent/25 to-purple-500/20 border border-accent/35 items-center justify-center shadow-glow-accent">
            <Film className="w-8 h-8 text-accent" />
          </div>

          <h2 className="text-lg sm:text-2xl font-bold mb-3 sm:mb-2 text-white tracking-tight">
            Что будем смотреть?
          </h2>
          <p className="hidden sm:block text-gray-400 text-sm mb-6 max-w-sm mx-auto leading-relaxed">
            Вставьте ссылку на ролик или прямую трансляцию для совместного синхронного просмотра
          </p>

          {/* Supported platform tags */}
          <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2 mb-4 sm:mb-6">
            {PLATFORMS.map((platform) => (
              <span
                key={platform.id}
                className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-medium border ${platform.border} ${platform.bg} ${platform.color} transition`}
              >
                {platform.name}
              </span>
            ))}
          </div>

          {canControl ? (
            <>
              {/* Video Input Form */}
              <form onSubmit={handleLoadVideo} className="flex flex-col gap-3">
                <VideoUrlInput
                  value={inputUrl}
                  onChange={handleUrlChange}
                  detectedName={detectedPlatform ? (platformMeta?.name || detectedPlatform.platform) : null}
                  ariaLabel="Ссылка на видео"
                  placeholder="Вставьте ссылку на видео"
                  className="py-3"
                />

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

              <div className="flex items-center gap-3 my-3 sm:my-4 text-[11px] text-gray-500 uppercase tracking-wider">
                <div className="flex-1 h-px bg-white/[0.08]" />
                <span>или</span>
                <div className="flex-1 h-px bg-white/[0.08]" />
              </div>

              <button
                type="button"
                onClick={handleStartScreenShare}
                disabled={isStreamConnecting}
                className="w-full flex items-center justify-center gap-2 bg-white/[0.05] hover:bg-white/[0.09] active:scale-[0.98] border border-border-subtle hover:border-accent/40 text-white font-semibold py-3 px-4 rounded-xl transition text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <MonitorUp className="w-4 h-4 text-accent" />
                <span>{isStreamConnecting ? 'Подключение...' : 'Транслировать экран с устройства'}</span>
              </button>

              <div className="hidden sm:flex mt-5 items-center justify-center gap-1.5 text-[11px] text-gray-500">
                <Lightbulb className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />
                <span>Совет: скопируйте ссылку из адресной строки браузера или приложения</span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-amber-400/10 border border-amber-400/25 text-amber-300 text-xs font-medium">
              <Lock className="w-4 h-4 shrink-0" />
              <span>Загрузить видео может только хост комнаты</span>
            </div>
          )}
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
          key={`yt-${parsedCurrent.id}`}
          ref={activePlayerRef}
          videoId={parsedCurrent.id}
          roomState={roomState}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onError={handleError}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
        />
      )}

      {parsedCurrent.platform === 'rutube' && (
        <RutubePlayer
          key={`rutube-${parsedCurrent.id}`}
          ref={activePlayerRef}
          videoId={parsedCurrent.id}
          roomState={roomState}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onError={handleError}
          onTimeUpdate={handleTimeUpdate}
        />
      )}

      {parsedCurrent.platform === 'twitch' && (
        <TwitchPlayer
          key={`twitch-${parsedCurrent.id}`}
          ref={activePlayerRef}
          videoId={parsedCurrent.id}
          twitchType={parsedCurrent.twitchType || 'channel'}
          roomState={roomState}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onError={handleError}
          onTimeUpdate={handleTimeUpdate}
        />
      )}

      {parsedCurrent.platform === 'vkvideo' && (
        <VKVideoPlayer
          key={`vk-${parsedCurrent.id}`}
          ref={activePlayerRef}
          videoId={parsedCurrent.id}
          roomState={roomState}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onError={handleError}
          onTimeUpdate={handleTimeUpdate}
        />
      )}

      {parsedCurrent.platform === 'dzen' && (
        <DzenPlayer
          key={`dzen-${parsedCurrent.id}`}
          ref={activePlayerRef}
          videoId={parsedCurrent.id}
          roomState={roomState}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onError={handleError}
          onTimeUpdate={handleTimeUpdate}
        />
      )}

      {/* Floating video reactions */}
      <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden">
        {floatingReactions.map((r) => (
          <span
            key={r.id}
            className="absolute bottom-16 text-4xl animate-float-up select-none"
            style={{ left: `${r.left}%` }}
          >
            {r.emoji}
          </span>
        ))}
      </div>

      {/* Reaction picker trigger — pushed up on mobile (<md) so it clears the
          "Кино" floating action button Room.jsx renders in the same corner
          there (that FAB is md:hidden and sits at a higher z-index). */}
      <div className="absolute bottom-16 md:bottom-4 right-3 sm:right-4 z-20 select-none pointer-events-auto">
        {showReactionPicker && (
          <div className="mb-2 flex items-center gap-1 p-1.5 bg-surface-raised/95 border border-border-medium rounded-full backdrop-blur-md shadow-glass animate-scale-in">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleSendReaction(emoji)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/[0.08] hover:scale-115 active:scale-90 transition text-base cursor-pointer"
                aria-label={`Отправить реакцию ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setShowReactionPicker((prev) => !prev)}
          className="flex items-center justify-center w-10 h-10 bg-surface-raised/85 hover:bg-surface-hover active:scale-95 text-gray-200 border border-border-subtle hover:border-accent/40 rounded-full backdrop-blur-md transition shadow-glass cursor-pointer ml-auto"
          title="Отправить реакцию"
          aria-label={showReactionPicker ? 'Закрыть панель реакций' : 'Открыть панель реакций'}
          aria-expanded={showReactionPicker}
        >
          <Smile className="w-4 h-4" />
        </button>
      </div>

      {/* Drift indicator + manual resync */}
      {showDriftBadge && (
        <div className="absolute bottom-16 sm:bottom-[4.25rem] left-3 sm:left-4 z-30 flex items-center gap-2 px-3 py-1.5 bg-amber-500/95 text-black text-xs font-semibold rounded-full shadow-xl backdrop-blur-md animate-slide-up">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>Отставание {Math.round(drift)}с</span>
          <button
            onClick={handleResync}
            className="flex items-center gap-1 px-2 py-0.5 bg-black/85 hover:bg-black text-white rounded-full transition text-[11px] font-bold cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Синхронизировать</span>
          </button>
        </div>
      )}

      {/* Video controls & sync badge bar */}
      <div className="absolute bottom-3 sm:bottom-4 left-3 sm:left-4 z-20 flex items-center gap-2 select-none pointer-events-auto">
        <button
          onClick={() => {
            if (!canControl) {
              showToast('Изменение видео доступно только хосту', 'warning', 3000);
              return;
            }
            setShowUrlChanger((prev) => !prev);
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 bg-surface-raised/85 hover:bg-surface-hover active:scale-95 text-xs text-gray-200 border border-border-subtle hover:border-accent/40 rounded-full backdrop-blur-md transition shadow-glass cursor-pointer ${!canControl ? 'opacity-50' : ''}`}
          title={canControl ? 'Сменить видеоисточник' : 'Изменение видео доступно только хосту'}
          aria-label="Сменить видеоисточник"
        >
          {canControl ? (
            <Link2 className="w-3.5 h-3.5 text-accent" />
          ) : (
            <Lock className="w-3.5 h-3.5 text-amber-400" />
          )}
          <span className="font-medium text-[11px] sm:text-xs">Сменить видео</span>
        </button>

        <button
          onClick={() => setShowUrlChanger(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-raised/85 hover:bg-surface-hover active:scale-95 text-xs text-gray-200 border border-border-subtle hover:border-accent/40 rounded-full backdrop-blur-md transition shadow-glass cursor-pointer"
          title="Очередь видео"
          aria-label={`Очередь видео${queue.length ? ` (${queue.length})` : ''}`}
        >
          <ListVideo className="w-3.5 h-3.5 text-accent" />
          <span className="font-medium text-[11px] sm:text-xs">
            Очередь{queue.length > 0 ? ` · ${queue.length}` : ''}
          </span>
        </button>

        {canControl && queue.length > 0 && (
          <button
            onClick={playNextFromQueue}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/90 hover:bg-accent-hover active:scale-95 text-xs text-white rounded-full backdrop-blur-md transition shadow-glass cursor-pointer"
            title="Запустить следующее видео из очереди"
            aria-label="Далее"
          >
            <SkipForward className="w-3.5 h-3.5" />
            <span className="font-medium text-[11px] sm:text-xs">Далее</span>
          </button>
        )}

        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-raised/75 border border-border-subtle rounded-full text-[11px] font-medium text-gray-300 backdrop-blur-md shadow-sm"
          title="Синхронный просмотр активен"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Синхронно</span>
        </div>

        {controlMode === 'host' && (
          <div
            className="hidden sm:flex items-center gap-1 px-2 py-1.5 bg-amber-400/10 border border-amber-400/25 rounded-full text-[11px] font-medium text-amber-300 backdrop-blur-md shadow-sm"
            title="Управление видео ограничено хостом"
          >
            <Lock className="w-3 h-3 text-amber-400" />
            <span>Только хост</span>
          </div>
        )}

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
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-10 sm:pt-16 p-4 overflow-y-auto animate-in fade-in duration-200"
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
                  Видео и очередь
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

            {canControl ? (
              <>
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
                  <VideoUrlInput
                    value={inputUrl}
                    onChange={handleUrlChange}
                    detectedName={detectedPlatform ? (platformMeta?.name || detectedPlatform.platform) : null}
                    ariaLabel="Новая ссылка на видео"
                    placeholder="https://..."
                    className="py-2.5"
                  />

                  {detectedPlatform && platformMeta && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 py-1.5 px-3 rounded-lg animate-fade-in">
                      <Check className="w-3.5 h-3.5" />
                      <span>Распознано: {platformMeta.name}</span>
                    </div>
                  )}

                  {/* Stacked full-width on phones (primary action on top), a row from sm: up */}
                  <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setShowUrlChanger(false)}
                      className="px-4 py-2.5 sm:py-2 text-xs font-semibold text-gray-300 hover:text-white hover:bg-white/[0.06] rounded-xl transition cursor-pointer"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      disabled={!inputUrl.trim()}
                      onClick={handleAddToQueue}
                      className="flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 text-xs font-semibold text-accent border border-accent/40 hover:bg-accent/10 rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <ListPlus className="w-3.5 h-3.5" />
                      <span>В очередь</span>
                    </button>
                    <button
                      type="submit"
                      disabled={!inputUrl.trim()}
                      className="px-4 py-2.5 sm:py-2 text-xs font-semibold bg-accent hover:bg-accent-hover text-white rounded-xl transition shadow-glow-accent disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      Запустить сейчас
                    </button>
                  </div>
                </form>

                <button
                  type="button"
                  onClick={handleStartScreenShare}
                  disabled={isStreamConnecting}
                  className="w-full mt-3 flex items-center justify-center gap-2 bg-white/[0.04] hover:bg-white/[0.08] active:scale-[0.98] border border-border-subtle hover:border-accent/40 text-gray-200 font-medium py-2.5 px-4 rounded-xl transition text-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <MonitorUp className="w-3.5 h-3.5 text-accent" />
                  <span>{isStreamConnecting ? 'Подключение...' : 'Транслировать экран вместо этого'}</span>
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2 py-3 px-4 rounded-xl bg-amber-400/10 border border-amber-400/25 text-amber-300 text-xs font-medium mb-1">
                <Lock className="w-4 h-4 shrink-0" />
                <span>Менять видео и очередь может только хост комнаты</span>
              </div>
            )}

            {/* Queue list */}
            <div className="mt-5 pt-4 border-t border-border-subtle">
              <div className="flex items-center gap-1.5 mb-2.5 text-xs font-semibold text-gray-300">
                <ListVideo className="w-3.5 h-3.5 text-accent" />
                <span>Очередь{queue.length > 0 ? ` (${queue.length})` : ''}</span>
              </div>

              {queue.length === 0 ? (
                <p className="text-gray-500 text-xs">Очередь пуста — добавьте следующий ролик выше.</p>
              ) : (
                <ul className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                  {queue.map((item, idx) => {
                    const canRemove = canControl && (isHost || String(item.addedBy) === String(userId));
                    return (
                      <li
                        key={item.id}
                        className="flex items-center gap-2 p-2 bg-surface/80 rounded-xl border border-border-subtle text-xs"
                      >
                        <span className="text-gray-500 font-mono shrink-0">{idx + 1}.</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-gray-200 font-mono text-[11px]">{item.url}</div>
                          <div className="text-[10px] text-gray-500">добавил {item.nickname || 'Аноним'}</div>
                        </div>
                        {canRemove && (
                          <button
                            type="button"
                            onClick={() => removeFromQueue(item.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer shrink-0"
                            title="Убрать из очереди"
                            aria-label={`Убрать из очереди: ${item.url}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
