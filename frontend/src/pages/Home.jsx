import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tv, Sparkles, ArrowRight } from 'lucide-react';

const getApiUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }
  const protocol = window.location.protocol;
  const hostname = window.location.hostname || 'localhost';
  return `${protocol}//${hostname}:3001`;
};

const API_URL = getApiUrl();

export default function Home() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const createRoom = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/rooms`, {
        method: 'POST',
      });
      const data = await res.json();

      if (data.roomId) {
        navigate(`/room/${data.roomId}`, { state: { hostId: data.hostId } });
      }
    } catch (err) {
      console.error(err);
      alert('Не удалось создать комнату. Проверьте соединение с бэкендом.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] px-4 py-8 bg-slate-950 text-white relative overflow-hidden">
      {/* Background glowing gradients */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 translate-y-1/2 w-80 h-80 bg-purple-600/20 blur-[100px] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-md w-full text-center space-y-6">
        {/* App Logo */}
        <div className="flex flex-col items-center justify-center">
          <img
            src="/onsh-logo.png"
            alt="onsh"
            className="h-20 sm:h-28 w-auto object-contain drop-shadow-[0_10px_25px_rgba(59,130,246,0.3)] select-none"
          />
          <p className="text-gray-400 text-sm sm:text-base mt-3">
            Синхронный просмотр видео, фильмов и трансляций с друзьями в реальном времени
          </p>
        </div>

        {/* Platform support badges */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <span className="px-3 py-1 bg-red-500/10 border border-red-500/20 text-red-400 rounded-full text-xs font-semibold">
            YouTube
          </span>
          <span className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-full text-xs font-semibold">
            Rutube
          </span>
          <span className="px-3 py-1 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-full text-xs font-semibold">
            Twitch
          </span>
        </div>

        {/* Create Room Button */}
        <div className="pt-4">
          <button
            onClick={createRoom}
            disabled={loading}
            className="w-full group flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] rounded-2xl font-bold text-base shadow-xl shadow-blue-600/30 transition-all disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Создаём комнату...
              </span>
            ) : (
              <>
                <span>Создать комнату</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </div>

        {/* Info card */}
        <div className="bg-gray-900/60 border border-gray-800/80 rounded-xl p-4 text-xs text-gray-400 flex items-center gap-3 text-left backdrop-blur-sm">
          <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
          <span>
            Без регистрации. Создайте комнату, скопируйте ссылку и отправьте друзьям на любое устройство.
          </span>
        </div>
      </div>
    </div>
  );
}
