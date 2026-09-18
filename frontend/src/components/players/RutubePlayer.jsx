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
  const ignoreEventsUntil = useRef(0);
  const isReadyRef = useRef(false);
  const currentRutubeTimeRef = useRef(0);
  const currentRutubeStateRef = useRef('paused');
  const lastKnownRutubeTime = useRef(0);
  const lastTimeCheck = useRef(Date.now());

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
      const elapsed = (Date.now() - (roomState.lastUpdatedAt || Date.now())) / 1000;
      expectedTime += Math.max(0, elapsed * (roomState.playbackRate || 1.0));
    }

    const drift = Math.abs(currentRutubeTimeRef.current - expectedTime);
    if (drift > 2.5 && roomState.isPlaying) {
      ignoreEventsUntil.current = Date.now() + 1500;
      postRutubeCommand('player:setCurrentTime', { time: Math.max(0, expectedTime) });
    }

    if (roomState.isPlaying && currentRutubeStateRef.current !== 'playing') {
      ignoreEventsUntil.current = Date.now() + 1500;
      postRutubeCommand('player:play');
    } else if (!roomState.isPlaying && currentRutubeStateRef.current === 'playing') {
      ignoreEventsUntil.current = Date.now() + 1500;
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
          lastKnownRutubeTime.current = 0;
          lastTimeCheck.current = Date.now();
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
            lastTimeCheck.current = Date.now();
            ignoreEventsUntil.current = Date.now() + 1000;
            onPlay?.(currentRutubeTimeRef.current);
          } else if (state === 'paused' || state === 'stopped') {
            lastKnownRutubeTime.current = currentRutubeTimeRef.current;
            lastTimeCheck.current = Date.now();
            ignoreEventsUntil.current = Date.now() + 1000;
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

  // Periodic drift correction & user seek detection
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isReadyRef.current) return;
      const rutubeTime = currentRutubeTimeRef.current;
      const now = Date.now();
      const deltaReal = (now - lastTimeCheck.current) / 1000;
      const deltaPlayer = rutubeTime - lastKnownRutubeTime.current;

      lastTimeCheck.current = now;
      lastKnownRutubeTime.current = rutubeTime;

      if (now < ignoreEventsUntil.current) {
        return;
      }

      // Check if user manually sought
      const isUserSeek =
        currentRutubeStateRef.current === 'playing' &&
        (deltaPlayer < -1.5 || (deltaPlayer - deltaReal > 3.0 && rutubeTime > 3.0));

      if (isUserSeek) {
        ignoreEventsUntil.current = now + 1500;
        onSeek?.(rutubeTime);
        return;
      }

      // If player drifted behind by > 3.5s during playback, quietly catch up locally
      let expectedTime = parseFloat(roomState.currentTime || 0);
      if (roomState.isPlaying) {
        const elapsed = (now - (roomState.lastUpdatedAt || now)) / 1000;
        expectedTime += Math.max(0, elapsed * (roomState.playbackRate || 1.0));
      }

      const drift = Math.abs(rutubeTime - expectedTime);
      if (drift > 3.5 && roomState.isPlaying) {
        ignoreEventsUntil.current = now + 1500;
        postRutubeCommand('player:setCurrentTime', { time: expectedTime });
      }
    }, 1000);

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
