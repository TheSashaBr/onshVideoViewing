import { useState } from 'react';
import { useRoomStore } from '../store/roomStore';
import { useVoiceStore } from '../store/voiceStore';
import { Users, Crown, Mic, MicOff, UserX, Check, X, ShieldAlert, Lock, Unlock } from 'lucide-react';
import VoiceChat, { VoiceEqualizer } from './VoiceChat';
import { MemberCardSkeleton } from './Skeleton';
import { cn } from '../utils/cn';

// Helper to extract emoji avatar or first letter
function parseAvatar(nickname = '') {
  const trimmed = nickname.trim();
  const emojiMatch = trimmed.match(/^\p{Extended_Pictographic}/u);
  if (emojiMatch) {
    return {
      avatar: emojiMatch[0],
      isEmoji: true,
      name: trimmed.replace(/^\p{Extended_Pictographic}\s*/u, '').trim() || trimmed
    };
  }
  return {
    avatar: (trimmed[0] || '?').toUpperCase(),
    isEmoji: false,
    name: trimmed || 'Участник'
  };
}

export default function Members() {
  const members = useRoomStore(state => state.members);
  const isJoining = useRoomStore(state => state.isJoining);
  const currentUserId = useRoomStore(state => state.userId);
  const currentNickname = useRoomStore(state => state.nickname);
  const isHost = useRoomStore(state => state.isHost);
  const kickUser = useRoomStore(state => state.kickUser);
  const hostMuteUser = useRoomStore(state => state.hostMuteUser);
  const controlMode = useRoomStore(state => state.roomState.controlMode);
  const setControlMode = useRoomStore(state => state.setControlMode);

  const roomVoiceUsers = useVoiceStore(state => state.roomVoiceUsers);
  const talkingUsers = useVoiceStore(state => state.talkingUsers);
  const isInVoice = useVoiceStore(state => state.isInVoice);
  const isMuted = useVoiceStore(state => state.isMuted);

  const [confirmKickId, setConfirmKickId] = useState(null);

  // Fallback: if members list is still populating, ensure current user is shown
  const displayMembers =
    members.length > 0
      ? members
      : currentUserId
      ? [
          {
            userId: currentUserId,
            nickname: currentNickname || 'Вы',
            isHost: isHost,
          },
        ]
      : [];

  const voiceCount = Math.max(roomVoiceUsers.size, isInVoice ? 1 : 0);

  const handleConfirmKick = (userId) => {
    kickUser(userId);
    setConfirmKickId(null);
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Voice Chat Section */}
      <div className="p-3.5 border-b border-border-subtle shrink-0">
        <VoiceChat variant="panel" />
      </div>

      {/* Playback Control Mode */}
      <div className="px-3.5 py-3 border-b border-border-subtle shrink-0">
        {isHost ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-gray-300 font-medium min-w-0">
              {controlMode === 'host' ? (
                <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <Unlock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              )}
              <span className="truncate">Кто управляет видео</span>
            </div>
            <div className="flex items-center gap-1 bg-surface-raised/80 border border-border-subtle rounded-full p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setControlMode('anyone')}
                className={cn(
                  'px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer',
                  controlMode !== 'host'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                )}
              >
                Все
              </button>
              <button
                type="button"
                onClick={() => setControlMode('host')}
                className={cn(
                  'px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer',
                  controlMode === 'host'
                    ? 'bg-amber-500 text-black shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                )}
              >
                Только хост
              </button>
            </div>
          </div>
        ) : (
          controlMode === 'host' && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-300/90">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span>Видео управляет только хост комнаты</span>
            </div>
          )
        )}
      </div>

      {/* Members Section Header */}
      <div className="px-4 py-3 bg-surface-raised/40 font-semibold border-b border-border-subtle shrink-0 flex items-center justify-between text-xs text-gray-200">
        <span className="flex items-center gap-2">
          <Users className="w-4 h-4 text-accent" />
          <span className="font-bold tracking-wide">Участники комнаты</span>
        </span>
        <div className="flex items-center gap-1.5">
          {voiceCount > 0 && (
            <span className="bg-emerald-500/15 text-emerald-400 text-[11px] px-2 py-0.5 rounded-full font-bold border border-emerald-500/25">
              🎤 {voiceCount} в звонке
            </span>
          )}
          <span className="bg-accent/15 text-accent text-[11px] px-2.5 py-0.5 rounded-full font-bold border border-accent/25">
            {displayMembers.length}
          </span>
        </div>
      </div>

      {/* Members List */}
      <ul
        role="list"
        aria-label="Список участников комнаты"
        className="flex-1 overflow-y-auto p-3 space-y-2 select-text"
      >
        {displayMembers.length === 0 && isJoining ? (
          <>
            <MemberCardSkeleton />
            <MemberCardSkeleton />
            <MemberCardSkeleton />
          </>
        ) : (
          displayMembers.map(m => {
            const isMe = String(m.userId) === String(currentUserId);
          const isInCall = (isMe && isInVoice) || roomVoiceUsers.has(String(m.userId)) || roomVoiceUsers.has(m.userId);
          const isTalking = talkingUsers.has(String(m.userId)) || talkingUsers.has(m.userId);
          const { avatar, isEmoji, name } = parseAvatar(m.nickname);
          const isConfirmingKick = confirmKickId === m.userId;

          return (
            <li
              key={m.userId}
              role="listitem"
              className={cn(
                'group relative flex items-center justify-between p-3 rounded-2xl transition-all duration-200 border',
                isMe
                  ? 'bg-accent/10 border-accent/30 shadow-sm'
                  : 'bg-surface-raised/60 hover:bg-surface-raised border-border-subtle hover:border-border-medium shadow-sm',
                isTalking && 'ring-1 ring-emerald-500/40 border-emerald-500/40 shadow-glow-voice'
              )}
            >
              {/* Left: Avatar, Name, and Role/Status */}
              <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
                {/* Avatar Icon */}
                <div
                  className={cn(
                    'w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 select-none shadow-sm transition-transform group-hover:scale-105',
                    isEmoji
                      ? 'bg-surface-hover/80 text-lg border border-border-subtle'
                      : isMe
                      ? 'bg-gradient-to-br from-accent to-indigo-700 text-white shadow-glow-accent'
                      : 'bg-white/[0.08] text-gray-200 border border-white/[0.08]'
                  )}
                >
                  {avatar}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="truncate font-semibold text-gray-100 text-sm">
                      {name}
                    </span>

                    {/* Current user badge */}
                    {isMe && (
                      <span className="text-[10px] text-accent font-bold bg-accent/20 border border-accent/30 px-1.5 py-0.2 rounded-md shrink-0">
                        Вы
                      </span>
                    )}

                    {/* Host crown badge */}
                    {m.isHost && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300 bg-amber-400/15 border border-amber-400/30 px-1.5 py-0.2 rounded-md shrink-0 shadow-sm">
                        <Crown className="w-3 h-3 text-amber-400" />
                        <span>Хост</span>
                      </span>
                    )}
                  </div>

                  {/* Status subtitle */}
                  <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-0.5">
                    {isInCall ? (
                      isTalking ? (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                          <VoiceEqualizer barClassName="bg-emerald-400" />
                          <span>Говорит</span>
                        </span>
                      ) : isMe && isMuted ? (
                        <span className="flex items-center gap-1 text-[11px] text-red-400 font-medium">
                          <MicOff className="w-3 h-3 text-red-400" />
                          <span>Микрофон выкл</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-300 font-medium">
                          <Mic className="w-3 h-3 text-emerald-400" />
                          <span>В звонке</span>
                        </span>
                      )
                    ) : (
                      <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
                        <span>онлайн</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Actions & Host Moderation */}
              <div className="flex items-center gap-1 shrink-0">
                {/* Host controls for other users */}
                {isHost && !isMe && (
                  <>
                    {/* Confirmation dialog for kick */}
                    {isConfirmingKick ? (
                      <div className="flex items-center gap-1 bg-surface-overlay border border-red-500/40 p-1 rounded-xl shadow-lg animate-scale-in">
                        <span className="text-[11px] text-red-300 font-semibold px-1">
                          Удалить?
                        </span>
                        <button
                          onClick={() => handleConfirmKick(m.userId)}
                          aria-label={`Подтвердить удаление ${name}`}
                          className="p-1 rounded-lg bg-red-600 hover:bg-red-500 text-white cursor-pointer transition active:scale-95"
                          title="Да, исключить"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmKickId(null)}
                          aria-label="Отмена"
                          className="p-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] text-gray-300 cursor-pointer transition active:scale-95"
                          title="Отмена"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        {/* Mute participant button if they are in voice */}
                        {isInCall && (
                          <button
                            onClick={() => hostMuteUser(m.userId)}
                            aria-label={`Выключить микрофон ${name}`}
                            className="p-1.5 rounded-xl text-gray-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition active:scale-95 cursor-pointer"
                            title="Выключить микрофон участнику"
                          >
                            <MicOff className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Kick user button */}
                        <button
                          onClick={() => setConfirmKickId(m.userId)}
                          aria-label={`Исключить ${name} из комнаты`}
                          className="p-1.5 rounded-xl text-gray-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition active:scale-95 cursor-pointer"
                          title="Исключить из комнаты"
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </li>
          );
          })
        )}
      </ul>
    </div>
  );
}
