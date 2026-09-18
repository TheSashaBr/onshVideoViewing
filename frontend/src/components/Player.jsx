import { useState } from 'react';
import { useRoomStore } from '../store/roomStore';
import { parseVideoUrl } from '../utils/urlHelper';
import YouTubePlayer from './players/YouTubePlayer';
import RutubePlayer from './players/RutubePlayer';
import TwitchPlayer from './players/TwitchPlayer';

export default function Player() {
  const roomState = useRoomStore(state => state.roomState);
  const sendMessage = useRoomStore(state => state.sendMessage);
  const loadVideo = useRoomStore(state => state.loadVideo);

  const [inputUrl, setInputUrl] = useState('');
  const [error, setError] = useState(null);
  const [showUrlChanger, setShowUrlChanger] = useState(false);

  const handleLoadVideo = (e) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    const parsed = parseVideoUrl(inputUrl);
    if (!parsed) {
      setError('Неподдерживаемая ссылка. Поддерживаются YouTube, Rutube и Twitch.');
      return;
    }

    setError(null);
    loadVideo(parsed.url, parsed.platform);
    setInputUrl('');
  };

  const handlePlay = (position) => {
    sendMessage('PLAY', { position: position || 0 });
  };

  const handlePause = (position) => {
    sendMessage('PAUSE', { position: position || 0 });
  };

  const handleSeek = (position) => {
    sendMessage('SEEK', { position, isPlaying: roomState.isPlaying });
  };

  const handleError = (errMsg) => {
    setError(errMsg);
  };

  const parsedCurrent = parseVideoUrl(roomState.videoUrl);

  // If no video loaded yet, show initial link input
  if (!parsedCurrent) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="bg-gray-800 p-8 rounded-xl max-w-lg w-full shadow-2xl border border-gray-700">
          <h2 className="text-2xl font-bold mb-3 text-white">Добавить видео или стрим</h2>
          <p className="text-gray-400 text-sm mb-6">
            Вставьте ссылку на ролик или трансляцию для совместного просмотра
          </p>

          <div className="flex justify-center gap-3 mb-6">
            <span className="px-3 py-1 bg-red-900/40 border border-red-700/50 text-red-300 rounded-full text-xs font-medium">
              🔴 YouTube
            </span>
            <span className="px-3 py-1 bg-blue-900/40 border border-blue-700/50 text-blue-300 rounded-full text-xs font-medium">
              🔵 Rutube
            </span>
            <span className="px-3 py-1 bg-purple-900/40 border border-purple-700/50 text-purple-300 rounded-full text-xs font-medium">
              🟣 Twitch
            </span>
          </div>

          <form onSubmit={handleLoadVideo} className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="https://youtu.be/... или rutube.ru/... или twitch.tv/..."
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {error && (
              <p className="text-red-400 text-sm text-left">{error}</p>
            )}
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors shadow-lg"
            >
              Запустить видео
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative group bg-black overflow-hidden flex items-center justify-center">
      {error && (
        <div className="absolute top-0 left-0 w-full bg-red-600 text-white p-2.5 text-center text-sm font-medium z-30 shadow-md">
          {error}
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

      {/* URL changer bar: visible on desktop hover, and accessible on mobile via button */}
      <div className="absolute bottom-4 left-4 z-20">
        <button
          onClick={() => setShowUrlChanger(prev => !prev)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-black/70 hover:bg-black/90 active:scale-95 text-xs text-gray-200 border border-white/20 rounded-full backdrop-blur-md transition shadow-lg"
          title="Сменить видео"
        >
          <span>🔗</span>
          <span className="font-medium">Сменить видео</span>
        </button>
      </div>

      {/* URL Changer Dialog / Input */}
      {showUrlChanger && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-30 flex items-center justify-center p-4">
          <div className="bg-gray-850 bg-gray-900 border border-gray-700 p-5 rounded-2xl max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white text-base font-bold">Сменить источник видео</h3>
              <button
                onClick={() => setShowUrlChanger(false)}
                className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded bg-gray-800"
              >
                ✕
              </button>
            </div>

            <p className="text-gray-400 text-xs mb-4">
              Вставьте ссылку на YouTube, Rutube или Twitch канал / запись
            </p>

            <form
              onSubmit={(e) => {
                handleLoadVideo(e);
                setShowUrlChanger(false);
              }}
              className="flex flex-col gap-3"
            >
              <input
                type="text"
                placeholder="https://..."
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setShowUrlChanger(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 rounded-lg transition"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition shadow"
                >
                  Загрузить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
