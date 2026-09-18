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
  const ignoreNextEvent = useRef(false);

  // Sync state from roomState -> YouTube player
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const syncPlayer = async () => {
      try {
        const playerState = await player.getPlayerState();
        const playerTime = await player.getCurrentTime();

        let expectedTime = parseFloat(roomState.currentTime);
        if (roomState.isPlaying) {
          const elapsed = (Date.now() - roomState.lastUpdatedAt) / 1000;
          expectedTime += elapsed * roomState.playbackRate;
        }

        const drift = Math.abs(playerTime - expectedTime);
        if (drift > 1.5) {
          ignoreNextEvent.current = true;
          player.seekTo(expectedTime, true);
        }

        // YT.PlayerState: PLAYING = 1, PAUSED = 2, BUFFERING = 3
        if (roomState.isPlaying && playerState !== 1 && playerState !== 3) {
          ignoreNextEvent.current = true;
          player.playVideo();
        } else if (!roomState.isPlaying && playerState === 1) {
          ignoreNextEvent.current = true;
          player.pauseVideo();
        }
      } catch (e) {
        console.error('YouTube sync error:', e);
      }
    };

    syncPlayer();
  }, [roomState]);

  // Detect local seek by user
  useEffect(() => {
    const interval = setInterval(async () => {
      const player = playerRef.current;
      if (!player) return;

      try {
        const playerTime = await player.getCurrentTime();
        let expectedTime = parseFloat(roomState.currentTime);
        if (roomState.isPlaying) {
          const elapsed = (Date.now() - roomState.lastUpdatedAt) / 1000;
          expectedTime += elapsed * roomState.playbackRate;
        }

        if (Math.abs(playerTime - expectedTime) > 2.0 && !ignoreNextEvent.current) {
          onSeek?.(playerTime);
        }
      } catch (e) {}
    }, 1000);

    return () => clearInterval(interval);
  }, [roomState, onSeek]);

  const handleReady = (e) => {
    playerRef.current = e.target;
    if (roomState.isPlaying) {
      e.target.playVideo();
    }
  };

  const handlePlay = async (e) => {
    if (ignoreNextEvent.current) {
      ignoreNextEvent.current = false;
      return;
    }
    const currentTime = await e.target.getCurrentTime();
    onPlay?.(currentTime);
  };

  const handlePause = async (e) => {
    if (ignoreNextEvent.current) {
      ignoreNextEvent.current = false;
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
