import { useEffect, useRef } from 'react';
import { useRoomStore } from '../../store/roomStore';

export default function TwitchPlayer({
  videoId,
  twitchType = 'channel',
  roomState,
  onPlay,
  onPause,
  onSeek,
  onError,
}) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const ignoreEventsUntil = useRef(0);
  const isReadyRef = useRef(false);
  const hasSyncedOnce = useRef(false);

  const lastRemoteAction = useRoomStore(state => state.lastRemoteAction);

  // Initialize Twitch player
  useEffect(() => {
    if (!window.Twitch || !window.Twitch.Player) {
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
      });

      player.addEventListener(window.Twitch.Player.PLAY, () => {
        if (Date.now() < ignoreEventsUntil.current) return;
        const time = twitchType === 'video' ? player.getCurrentTime() : 0;
        onPlay?.(time);
      });

      player.addEventListener(window.Twitch.Player.PAUSE, () => {
        if (Date.now() < ignoreEventsUntil.current) return;
        const time = twitchType === 'video' ? player.getCurrentTime() : 0;
        onPause?.(time);
      });

      player.addEventListener(window.Twitch.Player.SEEK, () => {
        if (twitchType === 'video' && Date.now() >= ignoreEventsUntil.current) {
          const time = player.getCurrentTime();
          onSeek?.(time);
        }
      });
    }

    return () => {
      if (playerRef.current) {
        playerRef.current = null;
        isReadyRef.current = false;
        hasSyncedOnce.current = false;
      }
    };
  }, [videoId, twitchType]);

  // React to remote actions
  useEffect(() => {
    if (!lastRemoteAction || !playerRef.current || !isReadyRef.current) return;
    const { type, payload, timestamp } = lastRemoteAction;
    const player = playerRef.current;

    try {
      if (type === 'PLAY') {
        ignoreEventsUntil.current = Date.now() + 1500;
        if (twitchType === 'video' && typeof payload?.position === 'number') {
          player.seek(payload.position);
        }
        player.play();
      } else if (type === 'PAUSE') {
        ignoreEventsUntil.current = Date.now() + 1500;
        player.pause();
        if (twitchType === 'video' && typeof payload?.position === 'number') {
          player.seek(payload.position);
        }
      } else if (type === 'SEEK') {
        if (twitchType === 'video') {
          ignoreEventsUntil.current = Date.now() + 1500;
          if (typeof payload?.position === 'number') {
            player.seek(payload.position);
          }
        }
      } else if (type === 'SYNC_STATE') {
        if (hasSyncedOnce.current) return;
        hasSyncedOnce.current = true;
        ignoreEventsUntil.current = Date.now() + 1500;

        if (twitchType === 'video') {
          let currentPos = parseFloat(payload.currentTime || 0);
          if (payload.isPlaying && timestamp) {
            const elapsed = (Date.now() - timestamp) / 1000;
            currentPos += Math.max(0, elapsed * (payload.playbackRate || 1.0));
          }
          if (currentPos > 0) {
            player.seek(currentPos);
          }
        }
        if (payload.isPlaying) {
          player.play();
        } else {
          player.pause();
        }
      }
    } catch (err) {
      console.error('Twitch remote action error:', err);
    }
  }, [lastRemoteAction, twitchType]);

  return (
    <div className="w-full h-full relative bg-black">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
