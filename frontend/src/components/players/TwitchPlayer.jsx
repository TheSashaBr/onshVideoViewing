import { useEffect, useRef } from 'react';

export default function TwitchPlayer({
  videoId,
  twitchType = 'channel', // 'channel' or 'video'
  roomState,
  onPlay,
  onPause,
  onSeek,
  onError,
}) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const ignoreNextEvent = useRef(false);
  const isReadyRef = useRef(false);

  useEffect(() => {
    if (!window.Twitch || !window.Twitch.Player) {
      // If script is not yet loaded, wait a bit
      const checkTimer = setInterval(() => {
        if (window.Twitch && window.Twitch.Player) {
          clearInterval(checkTimer);
          initPlayer();
        }
      }, 200);
      return () => clearInterval(checkTimer);
    } else {
      initPlayer();
    }

    function initPlayer() {
      if (!containerRef.current) return;
      containerRef.current.innerHTML = '';

      const hostname = window.location.hostname || 'localhost';
      const options = {
        width: '100%',
        height: '100%',
        autoplay: true,
        muted: false,
        playsinline: true,
        parent: [hostname, '127.0.0.1', 'localhost'],
      };

      if (twitchType === 'video') {
        options.video = videoId;
      } else {
        options.channel = videoId;
      }

      const player = new window.Twitch.Player(containerRef.current, options);
      playerRef.current = player;

      player.addEventListener(window.Twitch.Player.READY, () => {
        isReadyRef.current = true;
        if (roomState.isPlaying) {
          player.play();
        } else {
          player.pause();
        }
      });

      player.addEventListener(window.Twitch.Player.PLAY, () => {
        if (ignoreNextEvent.current) {
          ignoreNextEvent.current = false;
          return;
        }
        const time = twitchType === 'video' ? player.getCurrentTime() : 0;
        onPlay?.(time);
      });

      player.addEventListener(window.Twitch.Player.PAUSE, () => {
        if (ignoreNextEvent.current) {
          ignoreNextEvent.current = false;
          return;
        }
        const time = twitchType === 'video' ? player.getCurrentTime() : 0;
        onPause?.(time);
      });

      player.addEventListener(window.Twitch.Player.SEEK, () => {
        if (twitchType === 'video' && !ignoreNextEvent.current) {
          const time = player.getCurrentTime();
          onSeek?.(time);
        }
      });
    }

    return () => {
      if (playerRef.current) {
        playerRef.current = null;
        isReadyRef.current = false;
      }
    };
  }, [videoId, twitchType]);

  // Sync state from roomState -> Twitch player
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !isReadyRef.current) return;

    try {
      if (twitchType === 'video') {
        const playerTime = player.getCurrentTime();
        let expectedTime = parseFloat(roomState.currentTime || 0);
        if (roomState.isPlaying) {
          const elapsed = (Date.now() - roomState.lastUpdatedAt) / 1000;
          expectedTime += elapsed * (roomState.playbackRate || 1.0);
        }

        const drift = Math.abs(playerTime - expectedTime);
        if (drift > 2.0) {
          ignoreNextEvent.current = true;
          player.seek(expectedTime);
        }
      }

      const isPaused = player.isPaused();
      if (roomState.isPlaying && isPaused) {
        ignoreNextEvent.current = true;
        player.play();
      } else if (!roomState.isPlaying && !isPaused) {
        ignoreNextEvent.current = true;
        player.pause();
      }
    } catch (e) {
      console.error('Twitch sync error:', e);
    }
  }, [roomState, twitchType]);

  return (
    <div className="w-full h-full relative bg-black">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
