import { useEffect, useState, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { useRoomStore } from '../store/roomStore';
import { useVoiceStore } from '../store/voiceStore';
import Player from '../components/Player';
import Chat from '../components/Chat';
import Members from '../components/Members';
import VoiceChat from '../components/VoiceChat';
import {
  Share2,
  Minimize2,
  RotateCw,
  MessageSquare,
  Users,
  Check,
} from 'lucide-react';
import ToastContainer, { showToast } from '../components/ToastContainer';

export default function Room() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [nickname, setNickname] = useState('');
  const [hasJoined, setHasJoined] = useState(false);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'members'
  const [isLandscape, setIsLandscape] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isManualCinemaMode, setIsManualCinemaMode] = useState(() => window.innerWidth < 768);
  const [showFloatingChat, setShowFloatingChat] = useState(false);
  const [copied, setCopied] = useState(false);

  const containerRef = useRef(null);
  const joinRoom = useRoomStore(state => state.joinRoom);
  const leaveRoom = useRoomStore(state => state.leaveRoom);
  const socket = useRoomStore(state => state.socket);
  const members = useRoomStore(state => state.members);
  const chatMessages = useRoomStore(state => state.chatMessages);
  const connectionStatus = useRoomStore(state => state.connectionStatus);
  const isJoining = useRoomStore(state => state.isJoining);
  const hasJoinedRoom = useRoomStore(state => state.hasJoinedRoom);

  // Persist host token across page refreshes
  const hostTokenFromState = location.state?.hostToken;
  if (hostTokenFromState && roomId) {
    sessionStorage.setItem(`onsh_host_${roomId}`, hostTokenFromState);
  }
  const hostToken = hostTokenFromState || sessionStorage.getItem(`onsh_host_${roomId}`);
  const isHost = !!hostToken;

  useEffect(() => {
    return () => {
      useVoiceStore.getState().leaveVoice();
      leaveRoom();
    };
  }, [leaveRoom]);

  // Initialize room-wide voice listeners when socket connects to room
  useEffect(() => {
    if (socket && hasJoinedRoom) {
      useVoiceStore.getState().initVoiceRoomListeners(socket);
    }
  }, [socket, hasJoinedRoom]);

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

  // Toast notifications are handled directly by roomStore upon incoming MEMBER_JOINED and MEMBER_LEFT messages

  const handleJoin = (e) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    const userId = hostToken || uuidv4();
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
      <div className="flex flex-col items-center justify-center min-h-[100dvh] p-4 bg-[#0a0a0f] relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-blue-600/10 rounded-full blur-[120px]" />
        </div>
        <div className="relative z-10 bg-white/[0.03] border border-white/[0.08] p-7 sm:p-9 rounded-2xl shadow-2xl w-full max-w-sm backdrop-blur-sm">
          <div className="text-center mb-7">
            <img src="/onsh-logo.png" alt="onsh" className="h-8 mx-auto mb-4 opacity-60" />
            <h2 className="text-xl font-bold text-white mb-1">Войти в комнату</h2>
            <p className="text-gray-500 text-sm">
              Введите никнейм для просмотра
            </p>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <input
                type="text"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                placeholder="Ваш никнейм"
                className="w-full bg-white/[0.05] border border-white/[0.1] rounded-xl px-4 py-3 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition"
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={isJoining}
              className="w-full bg-white text-black active:scale-[0.97] py-3 rounded-xl font-bold shadow-lg transition duration-150 text-base disabled:opacity-60 cursor-pointer"
            >
              {isJoining ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                  Подключение...
                </span>
              ) : (
                'Присоединиться'
              )}
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
      className="flex flex-col md:flex-row h-[100dvh] w-full bg-[#0a0a0f] text-white overflow-hidden select-none relative"
    >
      <ToastContainer />

      {/* Loading overlay right after joining until room data arrives */}
      {isJoining && !hasJoinedRoom && (
        <div className="absolute inset-0 z-50 bg-[#0a0a0f]/90 backdrop-blur-md flex flex-col items-center justify-center p-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-12 h-12 border-3 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
            <div className="space-y-1">
              <p className="text-base font-medium text-white">Входим в комнату...</p>
              <p className="text-xs text-gray-500">Подключение к серверу и загрузка состояния</p>
            </div>
          </div>
        </div>
      )}

      {connectionStatus === 'reconnecting' && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-yellow-600 text-white text-center text-xs py-1 animate-pulse">
          Переподключение к серверу...
        </div>
      )}
      {connectionStatus === 'disconnected' && hasJoined && !isJoining && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-red-600 text-white text-center text-xs py-1">
          Соединение потеряно. Проверьте интернет.
        </div>
      )}
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
          <header className="bg-[#0a0a0f]/95 backdrop-blur-xl border-b border-white/[0.06] px-3 sm:px-5 py-2 flex justify-between items-center shrink-0 z-20 pt-safe">
            <button
              onClick={() => {
                leaveRoom();
                navigate('/');
              }}
              className="flex items-center gap-2 group text-left cursor-pointer focus:outline-none"
              title="Вернуться на главную"
            >
              <img
                src="/onsh-logo.png"
                alt="onsh"
                className="h-6 sm:h-7 w-auto object-contain group-hover:opacity-80 transition-opacity"
              />
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </button>

            <div className="flex items-center gap-1.5">
              <VoiceChat />

              <button
                onClick={handleShare}
                className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-white/[0.06] active:scale-95 text-xs font-medium rounded-lg text-gray-300 transition"
                title="Поделиться ссылкой"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Скопировано</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Пригласить</span>
                  </>
                )}
              </button>

              <button
                onClick={toggleRotateAndFullscreen}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/[0.08] hover:bg-white/[0.12] active:scale-95 text-xs font-medium rounded-lg text-white transition"
                title="Полноэкранный просмотр"
              >
                <RotateCw className="w-3.5 h-3.5" />
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
                  {/* Voice Chat in cinema mode */}
                  <VoiceChat compact />

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
          <div className="flex flex-col flex-1 min-h-0 md:hidden bg-[#0a0a0f]">
            {/* Mobile Tab Selector */}
            <div className="flex border-b border-white/[0.06] bg-[#0a0a0f]/90 shrink-0">
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
        <aside className="hidden md:flex w-80 lg:w-96 bg-[#0a0a0f] border-l border-white/[0.06] flex-col shrink-0 h-full">
          <div className="h-60 border-b border-white/[0.06] shrink-0 overflow-hidden">
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
