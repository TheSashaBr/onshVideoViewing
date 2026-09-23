import { useEffect, useState, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { useRoomStore } from '../store/roomStore';
import { useVoiceStore } from '../store/voiceStore';
import Player from '../components/Player';
import Chat from '../components/Chat';
import Members from '../components/Members';
import VoiceChat from '../components/VoiceChat';
import CameraBubbles from '../components/CameraBubbles';
import {
  Share2,
  Minimize2,
  Maximize2,
  RotateCw,
  MessageSquare,
  Users,
  Check,
  LogOut,
  WifiOff,
  RefreshCw,
  Tv,
  ArrowRight,
  X,
  Lock,
} from 'lucide-react';
import { showToast } from '../components/ToastContainer';
import { getApiUrl } from '../utils/api';

const AVATARS = ['🍿', '😎', '🎬', '🤖', '🦊', '🐱', '🐼', '🚀', '🌟', '🎧', '🎮', '🔥'];

export default function Room() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [selectedAvatar, setSelectedAvatar] = useState(() => {
    return localStorage.getItem('onsh_avatar') || '🍿';
  });
  const [nickname, setNickname] = useState(() => {
    return localStorage.getItem('onsh_nickname') || '';
  });
  const [hasJoined, setHasJoined] = useState(() => {
    return sessionStorage.getItem(`onsh_joined_${roomId}`) === 'true';
  });
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'members'
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [reconnectSeconds, setReconnectSeconds] = useState(0);
  const [showMobileMembersSheet, setShowMobileMembersSheet] = useState(false);

  const [isLandscape, setIsLandscape] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isManualCinemaMode, setIsManualCinemaMode] = useState(false);
  const [showFloatingChat, setShowFloatingChat] = useState(false);
  const [copied, setCopied] = useState(false);
  const [roomPasswordInput, setRoomPasswordInput] = useState('');
  const [roomHasPassword, setRoomHasPassword] = useState(false);

  const containerRef = useRef(null);
  const joinRoom = useRoomStore(state => state.joinRoom);
  const leaveRoom = useRoomStore(state => state.leaveRoom);
  const socket = useRoomStore(state => state.socket);
  const members = useRoomStore(state => state.members);
  const chatMessages = useRoomStore(state => state.chatMessages);
  const connectionStatus = useRoomStore(state => state.connectionStatus);
  const isJoining = useRoomStore(state => state.isJoining);
  const hasJoinedRoom = useRoomStore(state => state.hasJoinedRoom);
  const roomState = useRoomStore(state => state.roomState);
  const feedActive = useRoomStore(state => state.feed.active);
  const joinError = useRoomStore(state => state.joinError);
  const roomVoiceUsers = useVoiceStore(state => state.roomVoiceUsers);

  // Persist host token in localStorage (not sessionStorage) so host rights
  // survive closing the tab/browser on this device, not just a page refresh.
  const hostTokenFromState = location.state?.hostToken;
  if (hostTokenFromState && roomId) {
    localStorage.setItem(`onsh_host_${roomId}`, hostTokenFromState);
  }
  const hostToken = hostTokenFromState || localStorage.getItem(`onsh_host_${roomId}`);
  const isHost = !!hostToken;

  // The host never needs a password (they set it); find out up front for
  // everyone else whether this room requires one, so the field shows before
  // a failed join round-trip.
  useEffect(() => {
    if (isHost || !roomId) return;
    let cancelled = false;
    fetch(`${getApiUrl()}/api/rooms/${roomId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled && data) setRoomHasPassword(!!data.hasPassword);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [roomId, isHost]);

  // Server rejected the join because of a wrong/missing password — bounce
  // back to the join form (with the password field now known to be needed)
  // instead of getting stuck on the "Входим в комнату..." loading overlay.
  useEffect(() => {
    if (joinError === 'password') {
      setRoomHasPassword(true);
      try {
        sessionStorage.removeItem(`onsh_joined_${roomId}`);
      } catch (e) {}
      setHasJoined(false);
    }
  }, [joinError, roomId]);

  useEffect(() => {
    return () => {
      useVoiceStore.getState().leaveVoice();
      leaveRoom();
    };
  }, [leaveRoom]);

  // Initialize room-wide voice listeners when socket connects to room
  useEffect(() => {
    if (socket && hasJoinedRoom && roomId) {
      useVoiceStore.getState().initVoiceRoomListeners(socket, roomId);
    }
  }, [socket, hasJoinedRoom, roomId]);

  // Track screen orientation & window dimensions
  useEffect(() => {
    const handleOrientationChange = () => {
      const landscape = window.innerWidth > window.innerHeight;
      setIsLandscape(landscape);
    };

    handleOrientationChange();
    window.addEventListener('resize', handleOrientationChange);
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      window.removeEventListener('resize', handleOrientationChange);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, []);

  // Track fullscreen changes (including Safari webkit prefix)
  useEffect(() => {
    const handleFsChange = () => {
      const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(fs);
      if (!fs) {
        setIsManualCinemaMode(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  // Track unread chat messages when on another tab
  const prevMsgCountRef = useRef(chatMessages.length);
  useEffect(() => {
    if (chatMessages.length > prevMsgCountRef.current) {
      if (activeTab !== 'chat') {
        setHasUnreadChat(true);
      }
    }
    prevMsgCountRef.current = chatMessages.length;
  }, [chatMessages.length, activeTab]);

  const handleSelectTab = (tab) => {
    setActiveTab(tab);
    if (tab === 'chat') {
      setHasUnreadChat(false);
    }
  };

  // Touch gesture handling for dismissing mobile members bottom sheet
  const sheetTouchStartY = useRef(0);

  const handleSheetTouchStart = (e) => {
    sheetTouchStartY.current = e.touches[0].clientY;
  };

  const handleSheetTouchEnd = (e) => {
    const deltaY = e.changedTouches[0].clientY - sheetTouchStartY.current;
    if (deltaY > 60) {
      setShowMobileMembersSheet(false);
    }
  };

  // Escape key handler to close bottom sheet
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && showMobileMembersSheet) {
        setShowMobileMembersSheet(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showMobileMembersSheet]);

  // Watch connection status changes for feedback
  const prevConnectionStatusRef = useRef(connectionStatus);
  useEffect(() => {
    let timer;
    if (connectionStatus === 'reconnecting') {
      timer = setInterval(() => {
        setReconnectSeconds(s => s + 1);
      }, 1000);
    } else {
      setReconnectSeconds(0);
    }

    if (prevConnectionStatusRef.current === 'reconnecting' && connectionStatus === 'connected') {
      showToast('Соединение с сервером восстановлено', 'success', 3000);
    }
    prevConnectionStatusRef.current = connectionStatus;

    return () => clearInterval(timer);
  }, [connectionStatus]);

  const getOrCreateGuestId = (rId) => {
    const key = `onsh_guest_uid_${rId}`;
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = uuidv4();
      sessionStorage.setItem(key, id);
    }
    return id;
  };

  // Auto-rejoin room on page reload if previously joined in this tab session
  useEffect(() => {
    if (hasJoined && !hasJoinedRoom && !isJoining) {
      const savedNick = localStorage.getItem('onsh_nickname') || '';
      if (savedNick.trim()) {
        const savedAvatar = localStorage.getItem('onsh_avatar') || '🍿';
        const hasEmojiPrefix = /^\p{Extended_Pictographic}/u.test(savedNick);
        const fullNickname = hasEmojiPrefix ? savedNick : `${savedAvatar} ${savedNick}`;
        const userId = hostToken || getOrCreateGuestId(roomId);
        joinRoom(roomId, userId, fullNickname, isHost);
      } else {
        setHasJoined(false);
      }
    }
  }, [hasJoined, roomId]);

  const handleJoin = (e) => {
    if (e) e.preventDefault();
    const cleanNick = nickname.trim();
    if (!cleanNick) return;
    localStorage.setItem('onsh_avatar', selectedAvatar);
    localStorage.setItem('onsh_nickname', cleanNick);
    const hasEmojiPrefix = /^\p{Extended_Pictographic}/u.test(cleanNick);
    const fullNickname = hasEmojiPrefix ? cleanNick : `${selectedAvatar} ${cleanNick}`;
    const userId = hostToken || getOrCreateGuestId(roomId);
    sessionStorage.setItem(`onsh_joined_${roomId}`, 'true');
    joinRoom(roomId, userId, fullNickname, isHost, roomPasswordInput.trim());
    setHasJoined(true);
  };

  const handleLeaveRoom = () => {
    try {
      sessionStorage.removeItem(`onsh_joined_${roomId}`);
      sessionStorage.removeItem(`onsh_guest_uid_${roomId}`);
    } catch (e) {}
    leaveRoom();
    navigate('/');
  };

  // Toggle rotate / fullscreen
  const toggleRotateAndFullscreen = async () => {
    const target = containerRef.current || document.documentElement;
    const isCurrentlyActive = isFullscreen || isManualCinemaMode;

    if (!isCurrentlyActive) {
      setIsManualCinemaMode(true);
      try {
        if (target.requestFullscreen) {
          await target.requestFullscreen().catch(() => {});
        } else if (target.webkitRequestFullscreen) {
          await target.webkitRequestFullscreen().catch(() => {});
        }

        if (window.screen?.orientation?.lock) {
          await window.screen.orientation.lock('landscape').catch(() => {});
        }
      } catch (e) {
        // Fallback already activated via isManualCinemaMode
      }
    } else {
      setIsManualCinemaMode(false);
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen().catch(() => {});
        }

        if (window.screen?.orientation?.unlock) {
          window.screen.orientation.unlock();
        }
      } catch (e) {
        // Handled
      }
    }
  };

  // Native share or copy link
  const handleShare = async () => {
    const shareData = {
      title: 'onsh — Совместный просмотр',
      text: 'Подключайся к комнате onsh, смотрим видео вместе!',
      url: window.location.href,
    };

    if (navigator.share && /mobile|android|iphone|ipad/i.test(navigator.userAgent)) {
      try {
        await navigator.share(shareData);
        return;
      } catch (e) {
        // Fallback to copy
      }
    }

    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      showToast('Ссылка на комнату скопирована в буфер', 'info', 2500);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Clipboard write error:', e);
    }
  };

  // Nickname entry modal before joining
  if (!hasJoined) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] p-4 bg-surface text-white relative overflow-y-auto pt-safe pb-safe">
        {/* Ambient background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-[140px] animate-pulse"
            style={{ animationDuration: '8s' }}
          />
          <div
            className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-purple-600/10 rounded-full blur-[130px] animate-pulse"
            style={{ animationDuration: '10s' }}
          />
        </div>

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="nickname-modal-title"
          className="relative z-10 bg-surface-raised/95 border border-border-subtle p-6 sm:p-8 rounded-3xl shadow-glass-lg w-full max-w-sm backdrop-blur-xl animate-scale-in"
        >
          <div className="text-center mb-6">
            <img src="/onsh-logo.png" alt="onsh" className="h-8 mx-auto mb-3 opacity-90 select-none" />
            <h2 id="nickname-modal-title" className="text-xl font-bold text-white mb-1">
              Войти в комнату
            </h2>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.04] border border-border-subtle text-xs text-gray-400 font-mono">
              <span>комната:</span>
              <span className="text-gray-200 font-semibold">#{roomId?.slice(0, 10)}</span>
            </div>
          </div>

          <form onSubmit={handleJoin} className="space-y-5">
            {/* Avatar Selector */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-2 text-center">
                Выберите аватар
              </label>
              <div className="grid grid-cols-6 gap-2 p-2 bg-surface/80 rounded-2xl border border-border-subtle" role="radiogroup" aria-label="Выбор аватара">
                {AVATARS.map((av) => (
                  <button
                    key={av}
                    type="button"
                    role="radio"
                    aria-checked={selectedAvatar === av}
                    aria-label={`Выбрать аватар ${av}`}
                    onClick={() => setSelectedAvatar(av)}
                    className={`w-9 h-9 text-lg rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                      selectedAvatar === av
                        ? 'bg-accent/25 border-2 border-accent scale-110 shadow-glow-accent'
                        : 'hover:bg-white/[0.08] hover:scale-105'
                    }`}
                  >
                    {av}
                  </button>
                ))}
              </div>
            </div>

            {/* Nickname Input */}
            <div>
              <label htmlFor="nickname-input" className="block text-xs font-medium text-gray-400 mb-1.5">
                Ваше имя или никнейм
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-lg select-none" aria-hidden="true">
                  {selectedAvatar}
                </span>
                <input
                  id="nickname-input"
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Как вас называть?"
                  maxLength={24}
                  aria-label="Ваше имя или никнейм"
                  className="w-full bg-white/[0.04] border border-border-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition"
                  required
                  autoFocus
                />
              </div>
            </div>

            {/* Room Password (only when the room actually requires one) */}
            {roomHasPassword && (
              <div className="animate-fade-in">
                <label htmlFor="room-password-input" className="block text-xs font-medium text-gray-400 mb-1.5">
                  Пароль комнаты
                </label>
                <div className="relative flex items-center">
                  <span className="absolute left-3.5 text-gray-400">
                    <Lock className="w-4 h-4" />
                  </span>
                  <input
                    id="room-password-input"
                    type="password"
                    value={roomPasswordInput}
                    onChange={(e) => setRoomPasswordInput(e.target.value)}
                    placeholder="Введите пароль"
                    maxLength={100}
                    aria-label="Пароль комнаты"
                    className="w-full bg-white/[0.04] border border-border-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition"
                    required
                  />
                </div>
                {joinError === 'password' && (
                  <p className="mt-1.5 text-xs text-red-400">Неверный пароль, попробуйте ещё раз.</p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={isJoining || !nickname.trim() || (roomHasPassword && !roomPasswordInput.trim())}
              className="w-full group flex items-center justify-center gap-2 bg-gradient-to-r from-white via-gray-100 to-white text-black active:scale-[0.98] py-3.5 rounded-xl font-bold shadow-lg transition duration-150 text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isJoining ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                  Подключение...
                </span>
              ) : (
                <>
                  <span>Присоединиться к просмотру</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Cinema mode if in landscape on mobile, in fullscreen, or manually toggled
  const isCinemaMode = isFullscreen || isManualCinemaMode || (isLandscape && window.innerHeight < 600);
  const hasVideo = !!roomState?.videoUrl;

  return (
    <div
      ref={containerRef}
      className="flex flex-col md:flex-row h-[100dvh] w-full bg-surface text-white overflow-hidden select-none fixed inset-0"
    >
      {/* Loading overlay right after joining until room data arrives */}
      {isJoining && !hasJoinedRoom && (
        <div className="absolute inset-0 z-50 bg-surface/90 backdrop-blur-md flex flex-col items-center justify-center p-4">
          <div className="flex flex-col items-center gap-4 text-center animate-fade-in">
            <div className="w-12 h-12 border-3 border-accent/20 border-t-accent rounded-full animate-spin" />
            <div className="space-y-1">
              <p className="text-base font-semibold text-white">Входим в комнату...</p>
              <p className="text-xs text-gray-400">Подключение к серверу и синхронизация</p>
            </div>
          </div>
        </div>
      )}

      {/* Floating connection status toasts */}
      {connectionStatus === 'reconnecting' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 bg-yellow-500/90 text-black text-xs font-semibold rounded-full shadow-lg backdrop-blur-md animate-bounce">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>Переподключение к серверу... ({reconnectSeconds}с)</span>
        </div>
      )}

      {connectionStatus === 'disconnected' && hasJoined && !isJoining && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 bg-red-600/95 text-white text-xs font-semibold rounded-full shadow-xl backdrop-blur-md animate-slide-up">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>Соединение потеряно</span>
          <button
            onClick={() => {
              const fullNickname = `${selectedAvatar} ${nickname.trim()}`;
              const userId = hostToken || getOrCreateGuestId(roomId);
              joinRoom(roomId, userId, fullNickname, isHost, roomPasswordInput.trim());
            }}
            className="ml-2 px-2.5 py-0.5 bg-white text-red-600 rounded-lg text-[11px] font-bold hover:bg-gray-100 transition active:scale-95 cursor-pointer"
          >
            Переподключить
          </button>
        </div>
      )}

      {/* Main Video Section */}
      <div
        className={`flex flex-col min-w-0 h-full overflow-hidden transition-all duration-300 ${
          isCinemaMode ? 'w-full' : 'w-full md:flex-1'
        }`}
      >
        {/* Header: visible on desktop, or in mobile portrait when not in cinema mode */}
        {!isCinemaMode && (
          <header className="bg-surface/95 backdrop-blur-xl border-b border-border-subtle px-3 sm:px-5 py-2.5 flex justify-between items-center shrink-0 z-20 pt-safe">
            {/* Left: Brand logo & Room Code */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleLeaveRoom}
                className="flex items-center gap-2 group text-left cursor-pointer focus:outline-none"
                title="Вернуться на главную"
              >
                <img
                  src="/onsh-logo.png"
                  alt="onsh"
                  className="h-6 sm:h-7 w-auto object-contain group-hover:opacity-80 transition-opacity"
                />
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Комната активна" />
              </button>

              <button
                onClick={handleShare}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.04] hover:bg-white/[0.08] border border-border-subtle rounded-lg text-xs font-mono text-gray-400 hover:text-gray-200 transition cursor-pointer"
                title="Нажмите, чтобы скопировать ссылку на комнату"
              >
                <span className="text-gray-500">#</span>
                <span className="truncate max-w-[90px]">{roomId}</span>
              </button>
            </div>

            {/* Center: Video state pill (if video loaded) */}
            {roomState?.videoUrl ? (
              <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-surface-raised/70 border border-border-subtle rounded-full text-xs text-gray-300 max-w-[280px] shadow-sm">
                <Tv className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="capitalize font-semibold text-white/90 shrink-0">
                  {roomState.videoType}
                </span>
                <span className="text-gray-600">·</span>
                <span className="truncate text-gray-400">{roomState.videoUrl}</span>
              </div>
            ) : null}

            {/* Right: Controls & Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <VoiceChat />

              {/* Mobile Members Bottom Sheet Trigger */}
              <button
                onClick={() => setShowMobileMembersSheet(true)}
                aria-label={`Список участников (${members.length})`}
                className="md:hidden flex items-center gap-1.5 px-2.5 py-1.5 bg-white/[0.05] hover:bg-white/[0.09] active:scale-95 text-xs font-medium rounded-xl text-gray-200 border border-border-subtle transition cursor-pointer"
                title="Список участников"
              >
                <Users className="w-3.5 h-3.5 text-accent" />
                <span className="font-semibold">{members.length}</span>
                {roomVoiceUsers.size > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </button>

              <button
                onClick={handleShare}
                aria-label="Поделиться ссылкой на комнату"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.05] hover:bg-white/[0.09] active:scale-95 text-xs font-medium rounded-xl text-gray-200 border border-border-subtle transition cursor-pointer"
                title="Поделиться ссылкой"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-medium">Скопировано</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5 text-gray-400" />
                    <span className="hidden sm:inline">Пригласить</span>
                  </>
                )}
              </button>

              <button
                onClick={toggleRotateAndFullscreen}
                aria-label="Полноэкранный просмотр (Кино)"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.05] hover:bg-white/[0.09] active:scale-95 text-xs font-medium rounded-xl text-gray-200 border border-border-subtle transition cursor-pointer"
                title="Полноэкранный просмотр (Кино)"
              >
                <Maximize2 className="w-3.5 h-3.5 text-gray-300" />
                <span className="hidden md:inline">Кино</span>
              </button>

              <button
                onClick={handleLeaveRoom}
                aria-label="Выйти из комнаты"
                className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-red-500/10 active:scale-95 text-xs font-medium rounded-xl text-red-400 hover:text-red-300 border border-transparent hover:border-red-500/20 transition cursor-pointer"
                title="Выйти из комнаты"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Выйти</span>
              </button>
            </div>
          </header>
        )}

        {/* Video Player Container */}
        <main
          className={`relative bg-black ${
            isCinemaMode
              ? 'w-full h-full overflow-hidden flex items-center justify-center'
              // Shorts are 9:16 — a 16:9 box on a phone would leave them ~120px wide.
              : feedActive
              ? 'w-full h-[62dvh] md:h-auto md:flex-1 shrink-0 overflow-hidden flex items-center justify-center'
              : hasVideo
              ? 'w-full aspect-video md:aspect-auto md:flex-1 shrink-0 overflow-hidden flex items-center justify-center'
              // No video yet: on phones, size to the "what to watch" form (capped,
              // scrollable) instead of a 16:9 box it doesn't fit in — the chat
              // below takes whatever is left.
              : 'w-full shrink-0 max-h-[65dvh] overflow-y-auto md:max-h-none md:flex-1 md:overflow-hidden md:flex md:items-center md:justify-center'
          }`}
        >
          <Player />

          <CameraBubbles />

          {/* Mobile Floating Cinema Mode Button (FAB) */}
          {!isCinemaMode && hasVideo && (
            <button
              onClick={toggleRotateAndFullscreen}
              className="md:hidden absolute bottom-3 right-3 z-30 flex items-center gap-1.5 px-3 py-1.5 bg-black/75 hover:bg-black/90 active:scale-95 backdrop-blur-md text-white border border-white/20 rounded-full text-xs font-semibold shadow-glass transition-all cursor-pointer"
              title="Полноэкранный просмотр (Кино)"
              aria-label="Включить режим Кино"
            >
              <Maximize2 className="w-3.5 h-3.5 text-accent" />
              <span>Кино</span>
            </button>
          )}

          {/* Floating Controls in Cinema/Landscape Mode */}
          {isCinemaMode && (
            <>
              {/* Top controls in cinema mode */}
              <div className="absolute top-3 sm:top-4 left-3 right-3 flex items-center justify-between z-40 pointer-events-none pt-safe">
                <div className="pointer-events-auto bg-surface-raised/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-border-subtle text-xs font-medium text-gray-300 flex items-center gap-2 shadow-lg">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{members.length} онлайн</span>
                </div>

                <div className="flex items-center gap-2 pointer-events-auto">
                  {/* Voice Chat in cinema mode */}
                  <VoiceChat compact />

                  {/* Toggle floating chat */}
                  <button
                    onClick={() => setShowFloatingChat((prev) => !prev)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full backdrop-blur-md border text-xs font-semibold transition active:scale-95 cursor-pointer ${
                      showFloatingChat
                        ? 'bg-accent text-white border-accent-hover shadow-lg'
                        : 'bg-surface-raised/90 text-gray-200 border-border-subtle hover:bg-surface-hover'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Чат</span>
                  </button>

                  {/* Exit fullscreen/rotation */}
                  <button
                    onClick={toggleRotateAndFullscreen}
                    className="p-2 bg-surface-raised/90 hover:bg-surface-hover backdrop-blur-md text-white border border-border-subtle rounded-full transition active:scale-95 cursor-pointer"
                    title="Выйти из полноэкранного режима"
                  >
                    {isFullscreen ? (
                      <Minimize2 className="w-4 h-4" />
                    ) : (
                      <RotateCw className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Floating Chat in Cinema Mode */}
              {showFloatingChat && (
                <div className="absolute right-3 top-16 bottom-4 w-80 max-w-[85vw] z-40 animate-in fade-in slide-in-from-right duration-200">
                  <Chat isOverlay onCloseOverlay={() => setShowFloatingChat(false)} />
                </div>
              )}
            </>
          )}
        </main>

        {/* Mobile Tabs & Content (Only visible on small screens when NOT in cinema mode) */}
        {!isCinemaMode && (
          <div className="flex flex-col flex-1 min-h-0 md:hidden bg-surface">
            {/* Mobile Tab Selector with sliding active pill */}
            <div role="tablist" aria-label="Вкладки комнаты" className="relative flex border-b border-border-subtle bg-surface/90 shrink-0 p-1.5 gap-1">
              {/* Sliding active pill indicator */}
              <div
                aria-hidden="true"
                className="absolute top-1.5 bottom-1.5 rounded-xl bg-accent/20 border border-accent/40 shadow-sm transition-all duration-300 ease-out pointer-events-none"
                style={{
                  left: activeTab === 'chat' ? '6px' : 'calc(50% + 2px)',
                  width: 'calc(50% - 8px)',
                }}
              />

              <button
                role="tab"
                id="mobile-tab-chat"
                aria-controls="mobile-tabpanel-chat"
                aria-selected={activeTab === 'chat'}
                onClick={() => handleSelectTab('chat')}
                className={`relative z-10 flex-1 py-2 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                  activeTab === 'chat'
                    ? 'text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <MessageSquare className="w-4 h-4 text-accent" />
                <span>Чат</span>
                {hasUnreadChat && activeTab !== 'chat' && (
                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                )}
              </button>

              <button
                role="tab"
                id="mobile-tab-members"
                aria-controls="mobile-tabpanel-members"
                aria-selected={activeTab === 'members'}
                onClick={() => handleSelectTab('members')}
                className={`relative z-10 flex-1 py-2 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                  activeTab === 'members'
                    ? 'text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Users className="w-4 h-4 text-accent" />
                <span>Участники ({members.length})</span>
                {roomVoiceUsers.size > 0 && (
                  <span
                    className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"
                    title="Идёт голосовой звонок"
                  />
                )}
              </button>
            </div>

            {/* Tab Content: Fixed, rock-solid panels */}
            <div className="flex-1 min-h-0 relative overflow-hidden">
              <div
                role="tabpanel"
                id="mobile-tabpanel-chat"
                aria-labelledby="mobile-tab-chat"
                className={`absolute inset-0 flex flex-col ${
                  activeTab === 'chat'
                    ? 'visible z-10 pointer-events-auto'
                    : 'invisible z-0 pointer-events-none'
                }`}
              >
                <Chat />
              </div>
              <div
                role="tabpanel"
                id="mobile-tabpanel-members"
                aria-labelledby="mobile-tab-members"
                className={`absolute inset-0 flex flex-col ${
                  activeTab === 'members'
                    ? 'visible z-10 pointer-events-auto'
                    : 'invisible z-0 pointer-events-none'
                }`}
              >
                <Members />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Desktop Sidebar (Only visible on md: screens and above) */}
      {!isCinemaMode && (
        <aside className="hidden md:flex w-80 lg:w-96 bg-surface-raised border-l border-border-subtle flex-col shrink-0 h-full">
          {/* Sidebar Tab Selector */}
          <div role="tablist" aria-label="Вкладки сайдбара" className="p-2 border-b border-border-subtle flex items-center gap-1.5 bg-surface/60 shrink-0">
            <button
              role="tab"
              id="desktop-tab-chat"
              aria-controls="desktop-tabpanel-content"
              aria-selected={activeTab === 'chat'}
              onClick={() => handleSelectTab('chat')}
              className={`flex-1 py-2 px-3 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
                activeTab === 'chat'
                  ? 'bg-accent/15 text-white border border-accent/40 shadow-sm'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              <MessageSquare className="w-4 h-4 text-accent" />
              <span>Чат</span>
              {hasUnreadChat && activeTab !== 'chat' && (
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              )}
            </button>

            <button
              role="tab"
              id="desktop-tab-members"
              aria-controls="desktop-tabpanel-content"
              aria-selected={activeTab === 'members'}
              onClick={() => handleSelectTab('members')}
              className={`flex-1 py-2 px-3 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
                activeTab === 'members'
                  ? 'bg-accent/15 text-white border border-accent/40 shadow-sm'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              <Users className="w-4 h-4 text-accent" />
              <span>Участники</span>
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-white/[0.08] text-gray-300">
                {members.length}
              </span>
              {roomVoiceUsers.size > 0 && (
                <span
                  className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"
                  title="Идёт голосовой звонок"
                />
              )}
            </button>
          </div>

          {/* Sidebar Tab Content */}
          <div
            role="tabpanel"
            id="desktop-tabpanel-content"
            aria-labelledby={`desktop-tab-${activeTab}`}
            className="flex-1 overflow-hidden flex flex-col"
          >
            {activeTab === 'chat' ? <Chat /> : <Members />}
          </div>
        </aside>
      )}

      {/* Mobile Bottom Sheet for Members */}
      {showMobileMembersSheet && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-members-sheet-title"
          className="fixed inset-0 z-50 md:hidden flex flex-col justify-end"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setShowMobileMembersSheet(false)}
          />

          {/* Sheet Container */}
          <div
            className="relative z-10 w-full max-h-[82vh] bg-surface-raised border-t border-border-medium rounded-t-3xl shadow-glass-lg flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300 pb-safe"
          >
            {/* Drag Handle & Header — swipe-to-close lives here only, so a
                downward drag to scroll the list back up doesn't close the sheet */}
            <div
              className="pt-3 pb-2.5 px-4 border-b border-border-subtle bg-surface/80 flex flex-col shrink-0 select-none"
              onTouchStart={handleSheetTouchStart}
              onTouchEnd={handleSheetTouchEnd}
            >
              <div className="w-10 h-1 bg-white/25 rounded-full mx-auto mb-2.5 cursor-grab active:cursor-grabbing" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-accent" />
                  <span id="mobile-members-sheet-title" className="font-bold text-sm text-white">
                    Участники комнаты
                  </span>
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-accent/20 text-accent border border-accent/30">
                    {members.length}
                  </span>
                </div>
                <button
                  onClick={() => setShowMobileMembersSheet(false)}
                  aria-label="Закрыть список участников"
                  className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.08] transition cursor-pointer"
                  title="Закрыть"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sheet Body */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Members />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
