import { useEffect, useRef } from 'react';
import { useRoomStore } from '../../store/roomStore';

export default function RutubePlayer({
  videoId,
  roomState,
  onPlay,
  onPause,
  onSeek,
  onError,
}) {
  const iframeRef = useRef(null);
  const ignoreEventsUntil = useRef(0);
  const isReadyRef = useRef(false);
  const currentRutubeTimeRef = useRef(0);
  const currentRutubeStateRef = useRef('paused');
  const lastKnownRutubeTime = useRef(0);

  const lastRemoteAction = useRoomStore(state => state.lastRemoteAction);

  const postRutubeCommand = (type, data = {}) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ type, data }),
        '*'
      );
    }
  };

  // React strictly to REMOTE actions from other room members or server sync
  useEffect(() => {
    if (!lastRemoteAction || !isReadyRef.current) return;
    const { type, payload, timestamp } = lastRemoteAction;

    ignoreEventsUntil.current = Date.now() + 1500;

    try {
      if (type === 'PLAY') {
        if (typeof payload?.position === 'number') {
          postRutubeCommand('player:setCurrentTime', { time: payload.position });
        }
        postRutubeCommand('player:play');
      } else if (type === 'PAUSE') {
        postRutubeCommand('player:pause');
        if (typeof payload?.position === 'number') {
          postRutubeCommand('player:setCurrentTime', { time: payload.position });
        }
      } else if (type === 'SEEK') {
        if (typeof payload?.position === 'number') {
          postRutubeCommand('player:setCurrentTime', { time: payload.position });
        }
      } else if (type === 'SYNC_STATE') {
        let currentPos = parseFloat(payload.currentTime || 0);
        if (payload.isPlaying && timestamp) {
          const elapsed = (Date.now() - timestamp) / 1000;
          currentPos += Math.max(0, elapsed * (payload.playbackRate || 1.0));
        }
        postRutubeCommand('player:setCurrentTime', { time: currentPos });
        if (payload.isPlaying) {
          postRutubeCommand('player:play');
        } else {
          postRutubeCommand('player:pause');
        }
      }
    } catch (err) {
      console.error('Remote action playback error:', err);
    }
  }, [lastRemoteAction]);

  // Listen to messages from Rutube iframe
  useEffect(() => {
    const handleMessage = (event) => {
      let payload;
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch (e) {
        return;
      }

      if (!payload || !payload.type || !payload.type.startsWith('player:')) return;

      switch (payload.type) {
        case 'player:ready':
          isReadyRef.current = true;
          lastKnownRutubeTime.current = 0;
          if (roomState.isPlaying) {
            let expectedTime = parseFloat(roomState.currentTime || 0);
            const elapsed = (Date.now() - (roomState.lastUpdatedAt || Date.now())) / 1000;
            expectedTime += Math.max(0, elapsed * (roomState.playbackRate || 1.0));
            ignoreEventsUntil.current = Date.now() + 1500;
            postRutubeCommand('player:setCurrentTime', { time: expectedTime });
            postRutubeCommand('player:play');
          }
          break;

        case 'player:currentTime':
          if (typeof payload.data?.time === 'number') {
            currentRutubeTimeRef.current = payload.data.time;
          }
          break;

        case 'player:changeState': {
          const state = payload.data?.state; // 'playing', 'paused', 'stopped'
          currentRutubeStateRef.current = state;

          if (Date.now() < ignoreEventsUntil.current) {
            return;
          }

          if (state === 'playing') {
            lastKnownRutubeTime.current = currentRutubeTimeRef.current;
            onPlay?.(currentRutubeTimeRef.current);
          } else if (state === 'paused' || state === 'stopped') {
            lastKnownRutubeTime.current = currentRutubeTimeRef.current;
            onPause?.(currentRutubeTimeRef.current);
          }
          break;
        }

        case 'player:error':
          onError?.('Ошибка загрузки видео с Rutube. Возможно, видео удалено или ограничено автором.');
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [roomState, onPlay, onPause, onError]);

  // User seek detection: track timeline leaps
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isReadyRef.current) return;
      const rutubeTime = currentRutubeTimeRef.current;
      const prevTime = lastKnownRutubeTime.current;
      lastKnownRutubeTime.current = rutubeTime;

      if (Date.now() < ignoreEventsUntil.current) {
        return;
      }

      if (currentRutubeStateRef.current === 'playing') {
        const jump = rutubeTime - prevTime;
        if (jump < -1.5 || (jump > 3.0 && prevTime > 0.5)) {
          ignoreEventsUntil.current = Date.now() + 1500;
          onSeek?.(rutubeTime);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [onSeek]);

  const embedUrl = `https://rutube.ru/play/embed/${videoId}?skinColor=000000`;

  return (
    <div className="w-full h-full relative bg-black">
      <iframe
        ref={iframeRef}
        src={embedUrl}
        frameBorder="0"
        allow="clipboard-write; autoplay; fullscreen; encrypted-media; picture-in-picture"
        webkitAllowFullScreen
        mozallowfullscreen
        allowFullScreen
        playsInline
        className="w-full h-full absolute inset-0"
        title="Rutube Video Player"
      />
    </div>
  );
}
