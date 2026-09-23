import React, { useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import { useVoiceStore } from '../store/voiceStore';
import { useRoomStore } from '../store/roomStore';
import { cn } from '../utils/cn';

function getCleanNick(nick = '') {
  return nick.replace(/^\p{Extended_Pictographic}\s*/u, '').trim() || nick || 'Участник';
}

// Range of translate offsets that keeps the bubble fully inside the bounds,
// derived from where it's drawn now (rect) and the offset it's drawn with.
function offsetLimits(el, bounds, current) {
  const r = el.getBoundingClientRect();
  const b = bounds.getBoundingClientRect();
  return {
    minX: current.x + (b.left - r.left),
    maxX: current.x + (b.right - r.right),
    minY: current.y + (b.top - r.top),
    maxY: current.y + (b.bottom - r.bottom),
  };
}

function clampOffset(p, lim) {
  return {
    x: Math.max(lim.minX, Math.min(lim.maxX, p.x)),
    y: Math.max(lim.minY, Math.min(lim.maxY, p.y)),
  };
}

function CameraCircle({ track, nickname, boundsRef, isLocal = false }) {
  const videoRef = useRef(null);
  const circleRef = useRef(null);
  const dragRef = useRef(null);
  // desiredRef is where the user dropped the bubble; offset is where it is
  // drawn — desired clamped into the current video area. Keeping them apart
  // means a temporary shrink (resize, cinema toggle, the container's width
  // transition) can't permanently shove the bubble away from its spot.
  const desiredRef = useRef({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!track || !el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  useEffect(() => {
    const el = circleRef.current;
    const bounds = boundsRef.current;
    if (!el || !bounds || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const next = clampOffset(desiredRef.current, offsetLimits(el, bounds, offsetRef.current));
      const cur = offsetRef.current;
      if (next.x !== cur.x || next.y !== cur.y) setOffset(next);
    });
    ro.observe(bounds);
    ro.observe(el);
    return () => ro.disconnect();
  }, [boundsRef]);

  const handlePointerDown = (e) => {
    const el = circleRef.current;
    const bounds = boundsRef.current;
    if (!el || !bounds) return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch (err) {} // pointer may already be gone; drag still works while it's over the bubble

    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
      limits: offsetLimits(el, bounds, offset),
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const next = clampOffset(
      { x: d.originX + e.clientX - d.startX, y: d.originY + e.clientY - d.startY },
      d.limits
    );
    desiredRef.current = next;
    setOffset(next);
  };

  const handlePointerEnd = (e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
  };

  return (
    <div
      ref={circleRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      title="Перетащите, чтобы переместить"
      className={cn(
        'relative w-[clamp(4.5rem,6.5vw,6.5rem)] h-[clamp(4.5rem,6.5vw,6.5rem)] rounded-full overflow-hidden border-2 bg-black shrink-0',
        'pointer-events-auto touch-none select-none transition-shadow',
        isDragging
          ? 'z-10 cursor-grabbing border-white/50 shadow-glass-lg'
          : 'cursor-grab border-white/25 shadow-glass'
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        draggable={false}
        className={cn('w-full h-full object-cover pointer-events-none', isLocal && 'scale-x-[-1]')}
      />
      <span className="absolute bottom-0 inset-x-0 text-center text-[10px] sm:text-[11px] font-semibold text-white bg-black/60 truncate px-1 py-0.5 pointer-events-none">
        {nickname}
      </span>
    </div>
  );
}

export default function CameraBubbles() {
  const boundsRef = useRef(null);
  const isCameraOn = useVoiceStore(state => state.isCameraOn);
  const livekitRoom = useVoiceStore(state => state.livekitRoom);
  const remoteCameraTracks = useVoiceStore(state => state.remoteCameraTracks);
  const members = useRoomStore(state => state.members);
  const nickname = useRoomStore(state => state.nickname);

  const localTrack = isCameraOn
    ? livekitRoom?.localParticipant?.getTrackPublication(Track.Source.Camera)?.videoTrack
    : null;

  const remoteEntries = Object.entries(remoteCameraTracks);

  if (!localTrack && remoteEntries.length === 0) return null;

  return (
    <div ref={boundsRef} className="absolute inset-0 z-[25] pointer-events-none">
      {remoteEntries.length > 0 && (
        <div className="absolute top-3 sm:top-4 left-1/2 -translate-x-1/2 flex items-center gap-2.5 flex-wrap justify-center max-w-[90%]">
          {remoteEntries.map(([userId, track]) => {
            const m = members.find(mem => String(mem.userId) === String(userId));
            return (
              <CameraCircle
                key={userId}
                track={track}
                boundsRef={boundsRef}
                nickname={m ? getCleanNick(m.nickname) : 'Участник'}
              />
            );
          })}
        </div>
      )}

      {localTrack && (
        <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4">
          <CameraCircle track={localTrack} boundsRef={boundsRef} nickname={getCleanNick(nickname) || 'Вы'} isLocal />
        </div>
      )}
    </div>
  );
}
