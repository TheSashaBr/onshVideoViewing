import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useRoomStore } from '../../store/roomStore';

const TwitchPlayer = forwardRef(function TwitchPlayer({
  videoId,
  twitchType = 'channel',
  roomState,
  onPlay,
  onPause,
  onSeek,
  onError,
  onTimeUpdate,
}, ref) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const ignoreEventsUntil = useRef(0);
  const isReadyRef = useRef(false);
  const hasSyncedOnce = useRef(false);

  const lastRemoteAction = useRoomStore(state => state.lastRemoteAction);

  // Dynamically load Twitch Embed SDK on demand
  useEffect(() => {
    let isCancelled = false;

    function loadTwitchSDK() {
      return new Promise((resolve, reject) => {
        if (window.Twitch && window.Twitch.Player) {
          return resolve(window.Twitch);
        }
        const existingScript = document.getElementById('twitch-sdk-script');
        if (existingScript) {
          existingScript.addEventListener('load', () => resolve(window.Twitch));
          existingScript.addEventListener('error', reject);
          return;
        }
        const script = document.createElement('script');
        script.id = 'twitch-sdk-script';
        script.src = 'https://player.twitch.tv/js/embed/v1.js';
        script.async = true;
        script.onload = () => resolve(window.Twitch);
        script.onerror = (err) => reject(err);
        document.body.appendChild(script);
      });
    }

    loadTwitchSDK()
      .then(() => {
        if (!isCancelled) {
          initPlayer();
        }
      })
      .catch((err) => {
        console.error('Failed to load Twitch SDK:', err);
        onError?.('Не удалось загрузить плеер Twitch');
      });

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
      isCancelled = true;
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

  // Report playback position for the drift indicator. Only VODs ("video") have
  // a meaningful timeline — live channel streams have no fixed position.
  useEffect(() => {
    if (twitchType !== 'video') return;
    const interval = setInterval(() => {
      if (!isReadyRef.current || !playerRef.current) return;
      try {
        onTimeUpdate?.(playerRef.current.getCurrentTime());
      } catch (e) {}
    }, 1000);
    return () => clearInterval(interval);
  }, [twitchType, onTimeUpdate]);

  useImperativeHandle(ref, () => ({
    seekLocal: (time) => {
      if (twitchType !== 'video' || typeof time !== 'number' || isNaN(time)) return;
      try {
        ignoreEventsUntil.current = Date.now() + 1500;
        playerRef.current?.seek(time);
      } catch (e) {}
    }
  }), [twitchType]);

  return (
    <div className="w-full h-full relative bg-black">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
});

export default TwitchPlayer;
