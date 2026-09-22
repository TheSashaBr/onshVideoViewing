import { useEffect, useRef, useState } from 'react';
import { useVoiceStore } from '../../store/voiceStore';
import { Radio, MonitorOff, Volume2 } from 'lucide-react';

// Renders the "local video / screen share" video type. Unlike the URL-based
// platform players, this isn't a seekable embed — it's a live WebRTC relay
// (via the room's LiveKit connection) of whatever the presenter is sharing.
// The presenter sees a status card with a stop button; everyone else sees
// the incoming video track, with no seek/pause controls of their own.
export default function LocalStreamPlayer({ isOwner, ownerNickname, onDismissEnded }) {
  const videoRef = useRef(null);
  const [videoBlocked, setVideoBlocked] = useState(false);
  const [everHadTrack, setEverHadTrack] = useState(false);

  const remoteVideoTrack = useVoiceStore(state => state.remoteVideoTrack);
  const isStreamConnecting = useVoiceStore(state => state.isStreamConnecting);
  const audioBlocked = useVoiceStore(state => state.audioBlocked);
  const watchStream = useVoiceStore(state => state.watchStream);
  const stopWatchingStream = useVoiceStore(state => state.stopWatchingStream);
  const stopScreenShare = useVoiceStore(state => state.stopScreenShare);
  const unlockAudioPlayback = useVoiceStore(state => state.unlockAudioPlayback);

  // Viewers: connect to the LiveKit room to receive the stream while this
  // view is mounted, and stop watching (disconnect if nothing else needs
  // the connection) when it unmounts.
  useEffect(() => {
    if (isOwner) return;
    watchStream();
    return () => {
      stopWatchingStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);

  // Attach/detach the incoming video track to our <video> element.
  useEffect(() => {
    if (isOwner || !videoRef.current) return;
    if (!remoteVideoTrack) return;

    remoteVideoTrack.attach(videoRef.current);
    setEverHadTrack(true);
    videoRef.current.play().catch(() => setVideoBlocked(true));

    const el = videoRef.current;
    return () => {
      try { remoteVideoTrack.detach(el); } catch (e) {}
    };
  }, [isOwner, remoteVideoTrack]);

  const handleUnlock = async () => {
    if (videoRef.current) {
      try {
        await videoRef.current.play();
        setVideoBlocked(false);
      } catch (e) {}
    }
    if (audioBlocked) {
      await unlockAudioPlayback();
    }
  };

  if (isOwner) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-black text-center p-6">
        <div className="w-16 h-16 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center">
          <Radio className="w-7 h-7 text-red-400 animate-pulse" />
        </div>
        <div>
          <h3 className="text-white font-bold text-lg mb-1">Вы транслируете экран</h3>
          <p className="text-gray-400 text-sm max-w-sm">
            Все участники комнаты видят вашу трансляцию в реальном времени.
          </p>
        </div>
        <button
          onClick={stopScreenShare}
          className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 active:scale-95 text-white font-semibold text-sm rounded-xl transition cursor-pointer"
        >
          <MonitorOff className="w-4 h-4" />
          <span>Остановить трансляцию</span>
        </button>
      </div>
    );
  }

  if (!remoteVideoTrack) {
    if (everHadTrack) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-black text-center p-6">
          <MonitorOff className="w-8 h-8 text-gray-500" />
          <p className="text-gray-300 font-semibold text-sm">Трансляция завершена</p>
          {onDismissEnded && (
            <button
              onClick={onDismissEnded}
              className="px-4 py-2 bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs font-semibold rounded-xl transition cursor-pointer"
            >
              Закрыть
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-black text-center p-6">
        <div className="w-10 h-10 border-3 border-accent/20 border-t-accent rounded-full animate-spin" />
        <p className="text-gray-300 text-sm">
          {isStreamConnecting
            ? 'Подключение к трансляции...'
            : `Ожидание трансляции от ${ownerNickname || 'участника'}...`}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative bg-black flex items-center justify-center">
      <video ref={videoRef} className="w-full h-full object-contain" playsInline autoPlay />
      {(videoBlocked || audioBlocked) && (
        <button
          onClick={handleUnlock}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white cursor-pointer"
        >
          <Volume2 className="w-8 h-8" />
          <span className="text-sm font-semibold">Нажмите, чтобы включить просмотр</span>
        </button>
      )}
    </div>
  );
}
