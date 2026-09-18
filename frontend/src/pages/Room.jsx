import { useEffect, useState, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { useRoomStore } from '../store/roomStore';
import Player from '../components/Player';
import Chat from '../components/Chat';
import Members from '../components/Members';
import {
  Share2,
  Maximize2,
  Minimize2,
  RotateCw,
  MessageSquare,
  Users,
  Copy,
  Check,
} from 'lucide-react';

export default function Room() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [nickname, setNickname] = useState('');
  const [hasJoined, setHasJoined] = useState(false);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'members'
  const [isLandscape, setIsLandscape] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isManualCinemaMode, setIsManualCinemaMode] = useState(false);
  const [showFloatingChat, setShowFloatingChat] = useState(false);
  const [copied, setCopied] = useState(false);

  const containerRef = useRef(null);
  const joinRoom = useRoomStore(state => state.joinRoom);
  const leaveRoom = useRoomStore(state => state.leaveRoom);
  const members = useRoomStore(state => state.members);
  const chatMessages = useRoomStore(state => state.chatMessages);

  const hostId = location.state?.hostId;
  const isHost = !!hostId;

  useEffect(() => {
    return () => leaveRoom();
  }, [leaveRoom]);

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

  const handleJoin = (e) => {
    e.preventDefault();
    if (!nickname.trim()) return;

    const userId = hostId || uuidv4();
    joinRoom(roomId, userId, nickname.trim(), isHost);
    setHasJoined(true);
  };

  // Toggle rotate / fullscreen (with 100% Safari & iOS fallback)
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
        // User cancelled or share failed, fallback to copy
      }
    }

    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Clipboard write error:', e);
    }
  };

  if (!hasJoined) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] p-4 bg-slate-950">
        <div className="bg-gray-850 bg-gray-900/90 border border-gray-800 p-6 sm:p-8 rounded-2xl shadow-2xl w-full max-w-sm backdrop-blur-sm">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-white mb-1">Войти в комнату</h2>
            <p className="text-gray-400 text-xs sm:text-sm">
              Введите никнейм, чтобы присоединиться к просмотру
            </p>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
                Ваш никнейм
              </label>
              <input
                type="text"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                placeholder="Например: Алекс"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 active:scale-[0.98] py-3 rounded-xl font-semibold text-white shadow-lg transition duration-150 text-base"
            >
              Присоединиться
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Mobile cinema mode if in landscape on a mobile device, in fullscreen, or manual toggle
  const isCinemaMode = isFullscreen || isManualCinemaMode || (isLandscape && window.innerHeight < 600);

  return (
    <div
      ref={containerRef}
      className="flex flex-col md:flex-row h-[100dvh] w-full bg-slate-950 text-white overflow-hidden select-none"
    >
      {/* Main Video Section */}
      <div
        className={`flex flex-col min-w-0 transition-all duration-300 ${
          isCinemaMode
            ? 'w-full h-full'
            : 'w-full md:flex-1 h-auto md:h-full'
        }`}
      >
        {/* Header: visible on desktop, or in mobile portrait */}
        {!isCinemaMode && (
          <header className="bg-gray-900/95 border-b border-gray-800 px-3 sm:px-4 py-2.5 flex justify-between items-center shrink-0 z-20 pt-safe">
            <button
              onClick={() => {
                leaveRoom();
                navigate('/');
              }}
              className="flex items-center gap-2.5 group text-left cursor-pointer focus:outline-none"
              title="Вернуться на главную onsh"
            >
              <img
                src="/onsh-logo.png"
                alt="onsh"
                className="h-7 sm:h-8 w-auto object-contain group-hover:scale-105 transition-transform"
              />
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </button>

            {/* Quick Actions in Header */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleShare}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 active:scale-95 text-xs font-medium rounded-lg text-gray-200 border border-gray-700 transition"
                title="Поделиться ссылкой"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Скопировано!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5 text-blue-400" />
                    <span className="hidden sm:inline">Пригласить</span>
                  </>
                )}
              </button>

              <button
                onClick={toggleRotateAndFullscreen}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/90 hover:bg-blue-600 active:scale-95 text-xs font-medium rounded-lg text-white shadow transition"
                title="Полноэкранный просмотр / Поворот"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Повернуть</span>
              </button>
            </div>
          </header>
        )}

        {/* Video Player Container */}
        <main
          className={`relative bg-black overflow-hidden flex items-center justify-center ${
            isCinemaMode
              ? 'w-full h-full'
              : 'w-full aspect-video md:aspect-auto md:flex-1 shrink-0'
          }`}
        >
          <Player />

          {/* Floating Controls in Cinema/Landscape Mode */}
          {isCinemaMode && (
            <>
              {/* Top controls in cinema mode */}
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-30 pointer-events-none">
                <div className="pointer-events-auto bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 text-xs font-medium text-gray-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{members.length} онлайн</span>
                </div>

                <div className="flex items-center gap-2 pointer-events-auto">
                  {/* Toggle floating chat */}
                  <button
                    onClick={() => setShowFloatingChat(prev => !prev)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full backdrop-blur-md border text-xs font-semibold transition active:scale-95 ${
                      showFloatingChat
                        ? 'bg-blue-600 text-white border-blue-400 shadow-lg'
                        : 'bg-black/60 text-gray-200 border-white/10 hover:bg-black/80'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Чат</span>
                  </button>

                  {/* Exit fullscreen/rotation */}
                  <button
                    onClick={toggleRotateAndFullscreen}
                    className="p-2 bg-black/60 hover:bg-black/80 backdrop-blur-md text-white border border-white/10 rounded-full transition active:scale-95"
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
                <div className="absolute right-3 top-14 bottom-3 w-80 max-w-[85vw] z-40 animate-in fade-in slide-in-from-right duration-200">
                  <Chat
                    isOverlay
                    onCloseOverlay={() => setShowFloatingChat(false)}
                  />
                </div>
              )}
            </>
          )}
        </main>

        {/* Mobile Tabs & Content (Only visible on small screens when NOT in cinema mode) */}
        {!isCinemaMode && (
          <div className="flex flex-col flex-1 min-h-0 md:hidden bg-gray-900">
            {/* Mobile Tab Selector */}
            <div className="flex border-b border-gray-800 bg-gray-900/90 shrink-0">
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition-colors ${
                  activeTab === 'chat'
                    ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                <span>Чат</span>
                {chatMessages.length > 0 && (
                  <span className="bg-gray-800 text-gray-300 text-[10px] px-1.5 py-0.2 rounded-full">
                    {chatMessages.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('members')}
                className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition-colors ${
                  activeTab === 'members'
                    ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Участники ({members.length})</span>
              </button>
            </div>

            {/* Tab content area */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {activeTab === 'chat' ? <Chat /> : <Members />}
            </div>
          </div>
        )}
      </div>

      {/* Desktop Sidebar (Only visible on md: screens and above) */}
      {!isCinemaMode && (
        <aside className="hidden md:flex w-80 lg:w-96 bg-gray-900 border-l border-gray-800 flex-col shrink-0 h-full">
          <div className="h-60 border-b border-gray-800 shrink-0 overflow-hidden">
            <Members />
          </div>
          <div className="flex-1 overflow-hidden flex flex-col">
            <Chat />
          </div>
        </aside>
      )}
    </div>
  );
}
