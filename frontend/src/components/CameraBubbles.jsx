import React, { useEffect, useRef } from 'react';
import { Track } from 'livekit-client';
import { useVoiceStore } from '../store/voiceStore';
import { useRoomStore } from '../store/roomStore';
import { cn } from '../utils/cn';

function getCleanNick(nick = '') {
  return nick.replace(/^\p{Extended_Pictographic}\s*/u, '').trim() || nick || 'Участник';
}

function CameraCircle({ track, nickname, isLocal = false }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!track || !el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  return (
    <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden border-2 border-white/25 shadow-glass bg-black shrink-0">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={cn('w-full h-full object-cover', isLocal && 'scale-x-[-1]')}
      />
      <span className="absolute bottom-0 inset-x-0 text-center text-[9px] sm:text-[10px] font-semibold text-white bg-black/60 truncate px-1 py-0.5">
        {nickname}
      </span>
    </div>
  );
}

export default function CameraBubbles() {
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
    <>
      {remoteEntries.length > 0 && (
        <div className="absolute top-3 sm:top-4 left-1/2 -translate-x-1/2 z-[25] flex items-center gap-2 flex-wrap justify-center max-w-[90%] pointer-events-none">
          {remoteEntries.map(([userId, track]) => {
            const m = members.find(mem => String(mem.userId) === String(userId));
            return (
              <CameraCircle
                key={userId}
                track={track}
                nickname={m ? getCleanNick(m.nickname) : 'Участник'}
              />
            );
          })}
        </div>
      )}

      {localTrack && (
        <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4 z-[25] pointer-events-none">
          <CameraCircle track={localTrack} nickname={getCleanNick(nickname) || 'Вы'} isLocal />
        </div>
      )}
    </>
  );
}
