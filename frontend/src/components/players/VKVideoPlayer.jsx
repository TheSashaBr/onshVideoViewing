import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useRoomStore } from '../../store/roomStore';

const VKVideoPlayer = forwardRef(function VKVideoPlayer({
  videoId,
  roomState,
  onPlay,
  onPause,
  onSeek,
  onError,
  onTimeUpdate,
}, ref) {
  const iframeRef = useRef(null);
  const ignoreEventsUntil = useRef(Date.now() + 6000);
  const isReadyRef = useRef(false);
  const hasSyncedOnce = useRef(false);
  const currentTimeRef = useRef(0);
  const lastKnownTime = useRef(0);

  const lastRemoteAction = useRoomStore(state => state.lastRemoteAction);

  const postCommand = (action, value) => {
    if (iframeRef.current?.contentWindow) {
      const msg = value !== undefined ? { action, value } : { action };
      iframeRef.current.contentWindow.postMessage(msg, '*');
    }
  };

  // React to remote actions
  useEffect(() => {
    if (!lastRemoteAction || !isReadyRef.current) return;
    const { type, payload, timestamp } = lastRemoteAction;

    try {
      if (type === 'PLAY') {
        ignoreEventsUntil.current = Date.now() + 2500;
        if (typeof payload?.position === 'number') {
          const cur = currentTimeRef.current;
          if (Math.abs(cur - payload.position) > 2.5) {
            postCommand('seek', payload.position);
          }
        }
        postCommand('play');
      } else if (type === 'PAUSE') {
        ignoreEventsUntil.current = Date.now() + 2500;
        postCommand('pause');
        if (typeof payload?.position === 'number') {
          const cur = currentTimeRef.current;
          if (Math.abs(cur - payload.position) > 2.5) {
            postCommand('seek', payload.position);
          }
        }
      } else if (type === 'SEEK') {
        ignoreEventsUntil.current = Date.now() + 2500;
        if (typeof payload?.position === 'number') {
          currentTimeRef.current = payload.position;
          postCommand('seek', payload.position);
        }
      } else if (type === 'SYNC_STATE') {
        if (hasSyncedOnce.current) return;
        hasSyncedOnce.current = true;
        ignoreEventsUntil.current = Date.now() + 1500;

        let currentPos = parseFloat(payload.currentTime || 0);
        if (payload.isPlaying && timestamp) {
          const elapsed = (Date.now() - timestamp) / 1000;
          currentPos += Math.max(0, elapsed * (payload.playbackRate || 1.0));
        }
        if (currentPos > 0) {
          postCommand('seek', currentPos);
        }
        if (payload.isPlaying) {
          postCommand('play');
        } else {
          postCommand('pause');
        }
      }
    } catch (err) {
      console.error('VK remote action error:', err);
    }
  }, [lastRemoteAction]);

  useImperativeHandle(ref, () => ({
    seekLocal: (time) => {
      if (typeof time !== 'number' || isNaN(time)) return;
      ignoreEventsUntil.current = Date.now() + 1500;
      currentTimeRef.current = time;
      postCommand('seek', time);
    }
  }), []);

  // Listen to messages from VK iframe
  useEffect(() => {
    const handleMessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.event === 'inited' || data.event === 'started') {
        isReadyRef.current = true;
      }

      if (data.event === 'timeupdate' && data.data?.time !== undefined) {
        currentTimeRef.current = data.data.time;
      }

      if (Date.now() < ignoreEventsUntil.current) return;

      if (data.event === 'started' || data.event === 'resumed') {
        lastKnownTime.current = currentTimeRef.current;
        onPlay?.(currentTimeRef.current);
      } else if (data.event === 'paused') {
        lastKnownTime.current = currentTimeRef.current;
        onPause?.(currentTimeRef.current);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onPlay, onPause]);

  // User seek detection
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isReadyRef.current) return;
      const time = currentTimeRef.current;
      const prevTime = lastKnownTime.current;
      lastKnownTime.current = time;
      onTimeUpdate?.(time);

      if (Date.now() < ignoreEventsUntil.current) return;

      const jump = time - prevTime;
      if (jump < -1.5 || (jump > 3.0 && prevTime > 0.5)) {
        ignoreEventsUntil.current = Date.now() + 1500;
        onSeek?.(time);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [onSeek, onTimeUpdate]);

  // Build embed URL from VK video id format: -12345_67890
  const parts = videoId.split('_');
  const ownerId = parts[0];
  const vkVideoId = parts[1];
  const embedUrl = `https://vk.com/video_ext.php?oid=${ownerId}&id=${vkVideoId}&autoplay=1&hd=2`;

  return (
    <div className="w-full h-full relative bg-black">
      <iframe
        ref={iframeRef}
        src={embedUrl}
        frameBorder="0"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
        className="w-full h-full absolute inset-0"
        title="VK Video Player"
      />
    </div>
  );
});

export default VKVideoPlayer;
