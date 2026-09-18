import { useEffect, useRef, useState } from 'react';

export default function RutubePlayer({
  videoId,
  roomState,
  onPlay,
  onPause,
  onSeek,
  onError,
}) {
  const iframeRef = useRef(null);
  const ignoreNextEvent = useRef(false);
  const isReadyRef = useRef(false);
  const currentRutubeTimeRef = useRef(0);
  const currentRutubeStateRef = useRef('paused');

  const postRutubeCommand = (type, data = {}) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ type, data }),
        '*'
      );
    }
  };

  // Sync state from roomState -> Rutube player
  useEffect(() => {
    if (!isReadyRef.current) return;

    let expectedTime = parseFloat(roomState.currentTime || 0);
    if (roomState.isPlaying) {
      const elapsed = (Date.now() - roomState.lastUpdatedAt) / 1000;
      expectedTime += elapsed * (roomState.playbackRate || 1.0);
    }

    const drift = Math.abs(currentRutubeTimeRef.current - expectedTime);
    if (drift > 1.8) {
      ignoreNextEvent.current = true;
      postRutubeCommand('player:setCurrentTime', { time: Math.max(0, expectedTime) });
    }

    if (roomState.isPlaying && currentRutubeStateRef.current !== 'playing') {
      ignoreNextEvent.current = true;
      postRutubeCommand('player:play');
    } else if (!roomState.isPlaying && currentRutubeStateRef.current === 'playing') {
      ignoreNextEvent.current = true;
      postRutubeCommand('player:pause');
    }
  }, [roomState]);

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
          if (roomState.isPlaying) {
            let expectedTime = parseFloat(roomState.currentTime || 0);
            const elapsed = (Date.now() - roomState.lastUpdatedAt) / 1000;
            expectedTime += elapsed * (roomState.playbackRate || 1.0);
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

          if (ignoreNextEvent.current) {
            ignoreNextEvent.current = false;
            return;
          }

          if (state === 'playing') {
            onPlay?.(currentRutubeTimeRef.current);
          } else if (state === 'paused' || state === 'stopped') {
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

  // Check for local seek
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isReadyRef.current) return;
      let expectedTime = parseFloat(roomState.currentTime || 0);
      if (roomState.isPlaying) {
        const elapsed = (Date.now() - roomState.lastUpdatedAt) / 1000;
        expectedTime += elapsed * (roomState.playbackRate || 1.0);
      }

      const drift = Math.abs(currentRutubeTimeRef.current - expectedTime);
      if (drift > 2.5 && !ignoreNextEvent.current) {
        onSeek?.(currentRutubeTimeRef.current);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [roomState, onSeek]);

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
