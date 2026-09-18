import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Play, Users, Zap } from 'lucide-react';
import { getApiUrl } from '../utils/api';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const createRoom = async () => {
    setLoading(true);
    const apiUrl = getApiUrl();
    try {
      const res = await fetch(`${apiUrl}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data.roomId) {
        navigate(`/room/${data.roomId}`, { state: { hostToken: data.hostToken || data.hostId } });
      }
    } catch (err) {
      console.error('Create room error:', err);
      alert(`Не удалось создать комнату.\n${err.message || 'Ошибка сети'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0f] text-white relative overflow-hidden flex flex-col">
      {/* Animated background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-blue-600/8 rounded-full blur-[150px] animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-purple-600/8 rounded-full blur-[130px] animate-pulse" style={{ animationDuration: '10s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-indigo-500/5 rounded-full blur-[120px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 px-6 py-5 flex items-center justify-between">
        <img src="/onsh-logo.png" alt="onsh" className="h-8 sm:h-10 w-auto object-contain select-none" />
        <div className="text-xs text-gray-500 font-medium tracking-wider uppercase hidden sm:block">
          Watch Together
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-5 pb-12">
        <div className="max-w-lg w-full text-center space-y-8">
          {/* Hero */}
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.1]">
              Смотрите{' '}
              <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                вместе
              </span>
            </h1>
            <p className="text-gray-400 text-base sm:text-lg max-w-md mx-auto leading-relaxed">
              Синхронный просмотр видео с друзьями в реальном времени — без регистрации и установок
            </p>
          </div>

          {/* Platform grid */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-full text-xs font-medium">YouTube</span>
            <span className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-full text-xs font-medium">Rutube</span>
            <span className="px-3 py-1.5 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-full text-xs font-medium">Twitch</span>
            <span className="px-3 py-1.5 bg-sky-500/10 border border-sky-500/20 text-sky-400 rounded-full text-xs font-medium">VK Видео</span>
            <span className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-full text-xs font-medium">Dzen</span>
          </div>

          {/* CTA Button */}
          <button
            onClick={createRoom}
            disabled={loading}
            className="w-full group relative flex items-center justify-center gap-2.5 px-6 py-4 bg-white text-black font-bold text-base rounded-2xl shadow-2xl shadow-white/10 hover:shadow-white/20 active:scale-[0.97] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                Создаём...
              </span>
            ) : (
              <>
                <Play className="w-5 h-5 fill-current" />
                <span>Создать комнату</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>

          {/* Features */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <Zap className="w-4 h-4 text-blue-400 shrink-0" />
              <span className="text-xs text-gray-400">Mгновенный старт</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <Users className="w-4 h-4 text-purple-400 shrink-0" />
              <span className="text-xs text-gray-400">Чат в реальном времени</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <Play className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs text-gray-400">5 платформ</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 text-center py-4 text-xs text-gray-600">
        onsh &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
