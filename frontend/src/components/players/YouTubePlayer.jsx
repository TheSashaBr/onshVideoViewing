import { useEffect, useRef, useState } from 'react';
import YouTube from 'react-youtube';

export default function YouTubePlayer({
  videoId,
  roomState,
  onPlay,
  onPause,
  onSeek,
  onError,
}) {
  const playerRef = useRef(null);
  const ignoreEventsUntil = useRef(0);
  const lastKnownPlayerTime = useRef(0);
  const lastTimeCheck = useRef(Date.now());

  // Sync state from roomState -> YouTube player
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const syncPlayer = async () => {
      try {
        const playerState = await player.getPlayerState();
        const playerTime = await player.getCurrentTime();

        let expectedTime = parseFloat(roomState.currentTime || 0);
        if (roomState.isPlaying) {
          const elapsed = (Date.now() - (roomState.lastUpdatedAt || Date.now())) / 1000;
          expectedTime += Math.max(0, elapsed * (roomState.playbackRate || 1.0));
        }

        const drift = Math.abs(playerTime - expectedTime);
        if (drift > 2.5) {
          ignoreEventsUntil.current = Date.now() + 1500;
          player.seekTo(expectedTime, true);
        }

        // YT.PlayerState: PLAYING = 1, PAUSED = 2, BUFFERING = 3
        if (roomState.isPlaying && playerState !== 1 && playerState !== 3) {
          ignoreEventsUntil.current = Date.now() + 1500;
          player.playVideo();
        } else if (!roomState.isPlaying && playerState === 1) {
          ignoreEventsUntil.current = Date.now() + 1500;
          player.pauseVideo();
        }
      } catch (e) {
        console.error('YouTube sync error:', e);
      }
    };

    syncPlayer();
  }, [roomState]);

  // Periodic drift correction & user seek detection
  useEffect(() => {
    const interval = setInterval(async () => {
      const player = playerRef.current;
      if (!player) return;

      try {
        const playerTime = await player.getCurrentTime();
        const now = Date.now();
        const deltaReal = (now - lastTimeCheck.current) / 1000;
        const deltaPlayer = playerTime - lastKnownPlayerTime.current;

        lastTimeCheck.current = now;
        lastKnownPlayerTime.current = playerTime;

        // If we are in an ignored window (programmatic sync), don't check seeks
        if (now < ignoreEventsUntil.current) {
          return;
        }

        // Detect if the USER manually jumped on the timeline:
        // deltaPlayer < -1.5s (jumped back) or jumped forward much faster than real time passed
        const isUserSeek = deltaPlayer < -1.5 || (deltaPlayer - deltaReal > 3.0);
        if (isUserSeek) {
          ignoreEventsUntil.current = now + 1500;
          onSeek?.(playerTime);
          return;
        }

        // If not a user seek, but player has drifted behind the room by > 3.5s (e.g. buffering):
        // Silently catch up locally WITHOUT broadcasting and WITHOUT pausing
        let expectedTime = parseFloat(roomState.currentTime || 0);
        if (roomState.isPlaying) {
          const elapsed = (now - (roomState.lastUpdatedAt || now)) / 1000;
          expectedTime += Math.max(0, elapsed * (roomState.playbackRate || 1.0));
        }

        const drift = Math.abs(playerTime - expectedTime);
        if (drift > 3.5 && roomState.isPlaying) {
          ignoreEventsUntil.current = now + 1500;
          player.seekTo(expectedTime, true);
        }
      } catch (e) {}
    }, 1000);

    return () => clearInterval(interval);
  }, [roomState, onSeek]);

  const handleReady = (e) => {
    playerRef.current = e.target;
    lastKnownPlayerTime.current = 0;
    lastTimeCheck.current = Date.now();
    if (roomState.isPlaying) {
      e.target.playVideo();
    }
  };

  const handlePlay = async (e) => {
    if (Date.now() < ignoreEventsUntil.current) {
      return;
    }
    const currentTime = await e.target.getCurrentTime();
    onPlay?.(currentTime);
  };

  const handlePause = async (e) => {
    if (Date.now() < ignoreEventsUntil.current) {
      return;
    }
    const currentTime = await e.target.getCurrentTime();
    onPause?.(currentTime);
  };

  const handleError = () => {
    onError?.('Не удалось загрузить видео YouTube. Возможно, автор запретил встраивание.');
  };

  return (
    <div className="w-full h-full relative">
      <YouTube
        videoId={videoId}
        opts={{
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin,
          },
        }}
        onReady={handleReady}
        onPlay={handlePlay}
        onPause={handlePause}
        onError={handleError}
        className="w-full h-full absolute inset-0"
        iframeClassName="w-full h-full"
      />
    </div>
  );
}
