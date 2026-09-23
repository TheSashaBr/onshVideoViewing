import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import YouTube from 'react-youtube';
import { useRoomStore } from '../../store/roomStore';

const YouTubePlayer = forwardRef(function YouTubePlayer({
  videoId,
  roomState,
  onPlay,
  onPause,
  onSeek,
  onError,
  onTimeUpdate,
  onEnded,
}, ref) {
  const playerRef = useRef(null);
  // Startup grace period: ignore player initialization events for the first 6 seconds
  const ignoreEventsUntil = useRef(Date.now() + 6000);
  const lastKnownPlayerTime = useRef(0);
  const isInitialReady = useRef(false);

  const lastRemoteAction = useRoomStore(state => state.lastRemoteAction);

  const hasSyncedOnce = useRef(false);

  // React strictly to REMOTE actions from other room members or server sync
  useEffect(() => {
    if (!lastRemoteAction || !playerRef.current) return;
    const { type, payload, timestamp } = lastRemoteAction;
    const player = playerRef.current;

    try {
      if (type === 'PLAY') {
        ignoreEventsUntil.current = Date.now() + 2500;
        if (typeof payload?.position === 'number') {
          lastKnownPlayerTime.current = payload.position;
          try {
            const curTime = player.getCurrentTime ? player.getCurrentTime() : 0;
            if (Math.abs(curTime - payload.position) > 2.5) {
              player.seekTo(payload.position, true);
            }
          } catch (e) {}
        }
        player.playVideo();
      } else if (type === 'PAUSE') {
        ignoreEventsUntil.current = Date.now() + 2500;
        player.pauseVideo();
        if (typeof payload?.position === 'number') {
          lastKnownPlayerTime.current = payload.position;
          try {
            const curTime = player.getCurrentTime ? player.getCurrentTime() : 0;
            if (Math.abs(curTime - payload.position) > 2.5) {
              player.seekTo(payload.position, true);
            }
          } catch (e) {}
        }
      } else if (type === 'SEEK') {
        ignoreEventsUntil.current = Date.now() + 2500;
        if (typeof payload?.position === 'number') {
          lastKnownPlayerTime.current = payload.position;
          player.seekTo(payload.position, true);
        }
      } else if (type === 'SYNC_STATE') {
        // Only apply initial SYNC_STATE when entering room or on video load!
        if (hasSyncedOnce.current) {
          return;
        }
        hasSyncedOnce.current = true;
        ignoreEventsUntil.current = Date.now() + 2500;

        let currentPos = parseFloat(payload.currentTime || 0);
        if (payload.isPlaying && timestamp) {
          const elapsed = (Date.now() - timestamp) / 1000;
          currentPos += Math.max(0, elapsed * (payload.playbackRate || 1.0));
        }
        lastKnownPlayerTime.current = currentPos;
        if (currentPos > 0) {
          player.seekTo(currentPos, true);
        }
        if (payload.isPlaying) {
          player.playVideo();
        } else {
          player.pauseVideo();
        }
      }
    } catch (err) {
      console.error('Remote action playback error:', err);
    }
  }, [lastRemoteAction]);

  // Expose an imperative local-only seek for the drift-correction "Sync" button.
  // This must never broadcast to the room — only bump the ignore window so the
  // resulting native player event isn't mistaken for a user-initiated seek.
  // Local-only play/pause for callers that broadcast the change themselves
  // (the Shorts feed's tap-to-pause overlay): the native player event that
  // follows is suppressed so it isn't sent to the room a second time.
  useImperativeHandle(ref, () => ({
    seekLocal: (time) => {
      if (typeof time !== 'number' || isNaN(time)) return;
      try {
        ignoreEventsUntil.current = Date.now() + 2000;
        lastKnownPlayerTime.current = time;
        playerRef.current?.seekTo(time, true);
      } catch (e) {}
    },
    playLocal: async (atTime) => {
      const player = playerRef.current;
      if (!player) return;
      try {
        ignoreEventsUntil.current = Date.now() + 1500;
        if (typeof atTime === 'number' && !isNaN(atTime)) {
          const cur = await player.getCurrentTime();
          if (Math.abs(cur - atTime) > 1.5) player.seekTo(atTime, true);
          lastKnownPlayerTime.current = atTime;
        }
        player.playVideo();
      } catch (e) {}
    },
    pauseLocal: () => {
      try {
        ignoreEventsUntil.current = Date.now() + 1500;
        playerRef.current?.pauseVideo();
      } catch (e) {}
    },
    isPlayingLocal: async () => {
      try {
        return (await playerRef.current?.getPlayerState()) === 1;
      } catch (e) {
        return false;
      }
    },
    getTimeLocal: async () => {
      try {
        return (await playerRef.current?.getCurrentTime()) || 0;
      } catch (e) {
        return 0;
      }
    },
  }), []);

  const [useFallback, setUseFallback] = useState(false);

  const handleReady = (e) => {
    playerRef.current = e.target;
    isInitialReady.current = true;
    ignoreEventsUntil.current = Date.now() + 5000;

    let expectedTime = parseFloat(roomState.currentTime || 0);
    if (roomState.isPlaying) {
      const elapsed = (Date.now() - (roomState.lastUpdatedAt || Date.now())) / 1000;
      expectedTime += Math.max(0, elapsed * (roomState.playbackRate || 1.0));
    }
    lastKnownPlayerTime.current = expectedTime;
    if (expectedTime > 0) {
      try {
        e.target.seekTo(expectedTime, true);
      } catch (err) {}
    }
    if (roomState.isPlaying) {
      try {
        e.target.playVideo();
      } catch (err) {}
    }
  };

  const handlePlay = async (e) => {
    if (Date.now() < ignoreEventsUntil.current) {
      return;
    }
    try {
      const currentTime = await e.target.getCurrentTime();
      lastKnownPlayerTime.current = currentTime;
      onPlay?.(currentTime);
    } catch (err) {}
  };

  const handlePause = async (e) => {
    if (Date.now() < ignoreEventsUntil.current) {
      return;
    }
    try {
      const currentTime = await e.target.getCurrentTime();
      lastKnownPlayerTime.current = currentTime;
      onPause?.(currentTime);
    } catch (err) {}
  };

  // User seek detection: track significant time jumps during user interaction
  useEffect(() => {
    const interval = setInterval(async () => {
      const player = playerRef.current;
      if (!player || typeof player.getCurrentTime !== 'function') return;

      if (Date.now() < ignoreEventsUntil.current) {
        try {
          const t = await player.getCurrentTime();
          lastKnownPlayerTime.current = t;
          onTimeUpdate?.(t);
        } catch (e) {}
        return;
      }

      try {
        const playerTime = await player.getCurrentTime();
        onTimeUpdate?.(playerTime);
        const playerState = await player.getPlayerState();
        const prevTime = lastKnownPlayerTime.current;
        lastKnownPlayerTime.current = playerTime;

        // Only detect user scrub if player is active and the jump is > 2.5 seconds away from continuous progression
        if (playerState === 1 || playerState === 2) {
          const jump = playerTime - prevTime;
          // If backwards seek (< -2.5s) or large forward jump (> 4s within a 1s tick)
          if (jump < -2.5 || (jump > 4.0 && prevTime > 0.5)) {
            ignoreEventsUntil.current = Date.now() + 2500;
            onSeek?.(playerTime);
          }
        }
      } catch (e) {}
    }, 1000);

    return () => clearInterval(interval);
  }, [onSeek, onTimeUpdate]);

  const handleError = (e) => {
    console.warn('YouTube player error:', e);
    // If the API player fails with code 150/101 (embed restricted by origin check), try direct iframe fallback first
    if (!useFallback) {
      setUseFallback(true);
      return;
    }

    const errorCode = e?.data;
    let message = 'Не удалось загрузить видео YouTube.';
    if (errorCode === 101 || errorCode === 150) {
      message = 'Это видео запрещено к просмотру на сторонних сайтах его автором.';
    } else if (errorCode === 100) {
      message = 'Видео не найдено или удалено.';
    } else if (errorCode === 2) {
      message = 'Неверный идентификатор видео YouTube.';
    }
    onError?.(message);
  };

  if (useFallback) {
    return (
      <div className="w-full h-full relative bg-black">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1`}
          title="YouTube Video"
          className="w-full h-full absolute inset-0 border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <div className="w-full h-full relative bg-black">
      <YouTube
        key={videoId}
        videoId={videoId}
        opts={{
          width: '100%',
          height: '100%',
          host: 'https://www.youtube-nocookie.com',
          playerVars: {
            autoplay: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            enablejsapi: 1,
          },
        }}
        onReady={handleReady}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnd={() => onEnded?.()}
        onError={handleError}
        className="w-full h-full absolute inset-0"
        iframeClassName="w-full h-full"
      />
    </div>
  );
});

export default YouTubePlayer;
