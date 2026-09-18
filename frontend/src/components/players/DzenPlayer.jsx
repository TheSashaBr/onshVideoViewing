import { useEffect, useRef } from 'react';
import { useRoomStore } from '../../store/roomStore';

export default function DzenPlayer({
  videoId,
  roomState,
  onPlay,
  onPause,
  onSeek,
  onError,
}) {
  const iframeRef = useRef(null);
  const isReadyRef = useRef(false);
  const hasSyncedOnce = useRef(false);

  const lastRemoteAction = useRoomStore(state => state.lastRemoteAction);

  // Dzen embed has very limited external API
  // We track ready state but sync is limited to initial load
  useEffect(() => {
    const timer = setTimeout(() => {
      isReadyRef.current = true;
    }, 2000);
    return () => clearTimeout(timer);
  }, [videoId]);

  useEffect(() => {
    if (!lastRemoteAction || !isReadyRef.current) return;
    const { type } = lastRemoteAction;

    // Dzen doesn't expose a reliable postMessage API for sync
    // The video will play in the embed but precise sync is not possible
    if (type === 'SYNC_STATE' && !hasSyncedOnce.current) {
      hasSyncedOnce.current = true;
    }
  }, [lastRemoteAction]);

  const embedUrl = `https://dzen.ru/embed/${videoId}?autoplay=1`;

  return (
    <div className="w-full h-full relative bg-black">
      <iframe
        ref={iframeRef}
        src={embedUrl}
        frameBorder="0"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
        className="w-full h-full absolute inset-0"
        title="Dzen Video Player"
      />
      <div className="absolute bottom-2 left-2 z-10 px-2.5 py-1 bg-black/70 backdrop-blur-md rounded-full text-[10px] text-gray-400 border border-white/10">
        Dzen — ограниченная синхронизация
      </div>
    </div>
  );
}
