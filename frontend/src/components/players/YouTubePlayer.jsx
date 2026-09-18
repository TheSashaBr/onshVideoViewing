import { useEffect, useRef } from 'react';
import YouTube from 'react-youtube';
import { useRoomStore } from '../../store/roomStore';

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
        ignoreEventsUntil.current = Date.now() + 1500;
        if (typeof payload?.position === 'number') {
          player.seekTo(payload.position, true);
        }
        player.playVideo();
      } else if (type === 'PAUSE') {
        ignoreEventsUntil.current = Date.now() + 1500;
        player.pauseVideo();
        if (typeof payload?.position === 'number') {
          player.seekTo(payload.position, true);
        }
      } else if (type === 'SEEK') {
        ignoreEventsUntil.current = Date.now() + 1500;
        if (typeof payload?.position === 'number') {
          player.seekTo(payload.position, true);
        }
      } else if (type === 'SYNC_STATE') {
        // Only apply initial SYNC_STATE when entering room or on video load!
        // Never allow repeated server background syncs to violently yank the player to 0
        if (hasSyncedOnce.current) {
          return;
        }
        hasSyncedOnce.current = true;
        ignoreEventsUntil.current = Date.now() + 1500;

        let currentPos = parseFloat(payload.currentTime || 0);
        if (payload.isPlaying && timestamp) {
          const elapsed = (Date.now() - timestamp) / 1000;
          currentPos += Math.max(0, elapsed * (payload.playbackRate || 1.0));
        }
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

  const handleReady = (e) => {
    playerRef.current = e.target;
    lastKnownPlayerTime.current = 0;
    isInitialReady.current = true;

    // If room is already playing upon joining, sync to current position
    let expectedTime = parseFloat(roomState.currentTime || 0);
    if (roomState.isPlaying) {
      const elapsed = (Date.now() - (roomState.lastUpdatedAt || Date.now())) / 1000;
      expectedTime += Math.max(0, elapsed * (roomState.playbackRate || 1.0));
      ignoreEventsUntil.current = Date.now() + 1500;
      e.target.seekTo(expectedTime, true);
      e.target.playVideo();
    }
  };

  const handlePlay = async (e) => {
    if (Date.now() < ignoreEventsUntil.current) {
      return;
    }
    const currentTime = await e.target.getCurrentTime();
    lastKnownPlayerTime.current = currentTime;
    onPlay?.(currentTime);
  };

  const handlePause = async (e) => {
    if (Date.now() < ignoreEventsUntil.current) {
      return;
    }
    const currentTime = await e.target.getCurrentTime();
    lastKnownPlayerTime.current = currentTime;
    onPause?.(currentTime);
  };

  // User seek detection: track significant time jumps during user interaction
  useEffect(() => {
    const interval = setInterval(async () => {
      const player = playerRef.current;
      if (!player) return;

      try {
        const playerTime = await player.getCurrentTime();
        const playerState = await player.getPlayerState();
        const prevTime = lastKnownPlayerTime.current;
        lastKnownPlayerTime.current = playerTime;

        if (Date.now() < ignoreEventsUntil.current) {
          return;
        }

        // Only detect user scrub if player is active and the jump is > 3 seconds away from continuous progression
        if (playerState === 1 || playerState === 2) {
          const jump = playerTime - prevTime;
          // If backwards seek or large forward leap (> 3s within a 1s tick)
          if (jump < -1.5 || (jump > 3.0 && prevTime > 0.5)) {
            ignoreEventsUntil.current = Date.now() + 1500;
            onSeek?.(playerTime);
          }
        }
      } catch (e) {}
    }, 1000);

    return () => clearInterval(interval);
  }, [onSeek]);

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
