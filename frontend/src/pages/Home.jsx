import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Play,
  Tv,
  MessageSquare,
  Mic,
  Link2,
  Sparkles,
  Radio,
  Lock,
} from 'lucide-react';
import { getApiUrl } from '../utils/api';
import { showToast } from '../components/ToastContainer';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [joinInput, setJoinInput] = useState('');
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const createRoom = async () => {
    setLoading(true);
    const apiUrl = getApiUrl();
    try {
      const trimmedPassword = password.trim();
      const res = await fetch(`${apiUrl}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trimmedPassword ? { password: trimmedPassword } : {}),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data.roomId) {
        navigate(`/room/${data.roomId}`, {
          state: { hostToken: data.hostToken || data.hostId },
        });
      }
    } catch (err) {
      console.error('Create room error:', err);
      showToast(
        `Не удалось создать комнату: ${err.message || 'Ошибка сети'}`,
        'error',
        4000
      );
    } finally {
      setLoading(false);
    }
  };

  const handleJoinSubmit = (e) => {
    e.preventDefault();
    const trimmed = joinInput.trim();
    if (!trimmed) {
      showToast('Введите ID комнаты или ссылку', 'warning', 3000);
      return;
    }

    // Extract roomId if full URL or path was pasted
    const match = trimmed.match(/\/room\/([a-zA-Z0-9_-]+)/);
    const targetRoomId = match ? match[1] : trimmed.replace(/^[\s/]+|[\s/]+$/g, '');

    if (targetRoomId) {
      navigate(`/room/${targetRoomId}`);
    } else {
      showToast('Не удалось распознать ссылку на комнату', 'warning', 3000);
    }
  };

  const platforms = [
    { name: 'YouTube', color: 'text-red-400', border: 'border-red-500/20', bg: 'bg-red-500/10', hover: 'hover:border-red-500/50 hover:bg-red-500/20' },
    { name: 'Rutube', color: 'text-blue-400', border: 'border-blue-500/20', bg: 'bg-blue-500/10', hover: 'hover:border-blue-500/50 hover:bg-blue-500/20' },
    { name: 'Twitch', color: 'text-purple-400', border: 'border-purple-500/20', bg: 'bg-purple-500/10', hover: 'hover:border-purple-500/50 hover:bg-purple-500/20' },
    { name: 'VK Видео', color: 'text-sky-400', border: 'border-sky-500/20', bg: 'bg-sky-500/10', hover: 'hover:border-sky-500/50 hover:bg-sky-500/20' },
    { name: 'Dzen', color: 'text-amber-400', border: 'border-amber-500/20', bg: 'bg-amber-500/10', hover: 'hover:border-amber-500/50 hover:bg-amber-500/20' },
  ];

  return (
    <div className="min-h-[100dvh] w-full bg-surface text-white relative overflow-x-hidden flex flex-col justify-between selection:bg-accent/30 selection:text-white">
      {/* Ambient background glow effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-32 -left-32 w-[550px] h-[550px] bg-blue-600/10 rounded-full blur-[140px] animate-pulse"
          style={{ animationDuration: '9s' }}
        />
        <div
          className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[130px] animate-pulse"
          style={{ animationDuration: '11s' }}
        />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] bg-purple-600/5 rounded-full blur-[150px]" />
      </div>

      {/* Top Header */}
      <header className="relative z-10 px-4 sm:px-6 py-4 sm:py-5 max-w-6xl w-full mx-auto flex items-center justify-between pt-safe">
        <div className="flex items-center gap-3">
          <img
            src="/onsh-logo.png"
            alt="onsh"
            className="h-9 sm:h-11 w-auto object-contain select-none transition-transform hover:scale-105 duration-200"
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-raised/80 border border-border-subtle text-xs text-gray-400 backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-medium text-gray-300">Сервис активен</span>
        </div>
      </header>

      {/* Main Hero & Actions */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-8 sm:py-14 max-w-3xl w-full mx-auto">
        <div className="w-full text-center space-y-8 animate-fade-in">
          {/* Tagline */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-border-subtle text-xs font-medium text-gray-300 backdrop-blur-sm shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span>Совместный просмотр видео нового поколения</span>
          </div>

          {/* Heading & Subtitle */}
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.1]">
              Смотрите{' '}
              <span className="bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
                вместе
              </span>
            </h1>
            <p className="text-gray-400 text-sm sm:text-lg max-w-lg mx-auto leading-relaxed">
              Синхронное воспроизведение видео с друзьями в реальном времени, встроенный чат и живая голосовая связь — без регистрации и установок.
            </p>
          </div>

          {/* Supported Platforms Pills */}
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
              Поддерживаемые платформы
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {platforms.map((p) => (
                <span
                  key={p.name}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-all duration-200 cursor-default select-none ${p.bg} ${p.border} ${p.color} ${p.hover}`}
                >
                  {p.name}
                </span>
              ))}
            </div>
          </div>

          {/* CTAs Section: 2 Primary Actions */}
          <div className="max-w-md mx-auto space-y-4 pt-2">
            {/* Action 1: Create Room */}
            <button
              onClick={createRoom}
              disabled={loading}
              className="w-full group relative flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-white via-gray-100 to-white text-black font-bold text-base rounded-2xl shadow-xl shadow-white/5 hover:shadow-indigo-500/20 active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                  Создаём комнату...
                </span>
              ) : (
                <>
                  <div className="w-7 h-7 rounded-xl bg-black text-white flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  </div>
                  <span>Создать новую комнату</span>
                  <ArrowRight className="w-4 h-4 text-gray-500 group-hover:text-black group-hover:translate-x-1 transition-all" />
                </>
              )}
            </button>

            {/* Optional room password */}
            {showPasswordField ? (
              <div className="flex items-center bg-surface-raised/80 border border-border-subtle focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/20 rounded-2xl p-1.5 transition-all duration-200 animate-fade-in">
                <div className="pl-3 pr-2 text-gray-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Пароль комнаты (необязательно)"
                  aria-label="Пароль комнаты"
                  maxLength={100}
                  className="w-full bg-transparent text-sm text-white placeholder-gray-500 outline-none px-2 py-2"
                />
                <button
                  type="button"
                  onClick={() => { setShowPasswordField(false); setPassword(''); }}
                  aria-label="Убрать пароль"
                  className="px-3 py-2 text-xs text-gray-400 hover:text-white transition cursor-pointer shrink-0"
                >
                  Убрать
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowPasswordField(true)}
                className="flex items-center justify-center gap-1.5 mx-auto text-xs text-gray-500 hover:text-gray-300 transition cursor-pointer"
              >
                <Lock className="w-3 h-3" />
                <span>Защитить комнату паролем</span>
              </button>
            )}

            {/* Divider */}
            <div className="flex items-center gap-3 text-xs text-gray-500 uppercase tracking-wider">
              <div className="flex-1 h-px bg-white/[0.08]" />
              <span>или подключитесь по ссылке</span>
              <div className="flex-1 h-px bg-white/[0.08]" />
            </div>

            {/* Action 2: Join by Link or ID */}
            <form onSubmit={handleJoinSubmit} className="relative group">
              <div className="flex items-center bg-surface-raised/80 hover:bg-surface-raised border border-border-subtle focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/20 rounded-2xl p-1.5 transition-all duration-200 shadow-glass">
                <div className="pl-3 pr-2 text-gray-400 group-focus-within:text-accent transition-colors">
                  <Link2 className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value)}
                  placeholder="Вставьте ссылку или ID комнаты..."
                  aria-label="Ссылка или ID комнаты"
                  className="w-full bg-transparent text-sm text-white placeholder-gray-500 outline-none px-2 py-2"
                />
                <button
                  type="submit"
                  aria-label="Войти в комнату"
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-accent hover:bg-accent-hover active:scale-95 text-white font-semibold text-xs rounded-xl shadow-md transition-all duration-150 cursor-pointer shrink-0"
                >
                  <span>Войти</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>

          {/* Feature Highlight Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-6 text-left">
            <div className="p-4 rounded-2xl bg-surface-raised/40 hover:bg-surface-raised/80 border border-border-subtle hover:border-border-medium backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-glass group">
              <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <Tv className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-semibold text-white mb-1">Синхронный плеер</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                Воспроизведение, пауза и перемотка происходят синхронно у всех зрителей.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-surface-raised/40 hover:bg-surface-raised/80 border border-border-subtle hover:border-border-medium backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-glass group">
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <MessageSquare className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-semibold text-white mb-1">Живой чат</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                Мгновенные сообщения, индикатор набора текста и системные уведомления.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-surface-raised/40 hover:bg-surface-raised/80 border border-border-subtle hover:border-border-medium backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-glass group">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <Mic className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-semibold text-white mb-1">Голосовая связь</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                Встроенный голосовой чат без задержек — говорите голосом прямо в браузере.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 px-4 border-t border-border-subtle text-center text-xs text-gray-500 max-w-6xl w-full mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 pb-safe mt-10 sm:mt-16">
        <div className="flex flex-wrap items-center justify-center gap-2 text-gray-400">
          <span>⚡ Мгновенный запуск</span>
          <span>·</span>
          <span>🔒 Без регистрации</span>
          <span>·</span>
          <span>🎬 5 видеоплатформ</span>
        </div>
        <div>
          onsh &copy; {new Date().getFullYear()} · Совместный просмотр видео
        </div>
      </footer>
    </div>
  );
}
