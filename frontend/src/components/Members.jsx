import { useRoomStore } from '../store/roomStore';
import { useVoiceStore } from '../store/voiceStore';
import { Users, Crown, Mic, MicOff, Volume2 } from 'lucide-react';
import VoiceChat from './VoiceChat';

export default function Members() {
  const members = useRoomStore(state => state.members);
  const currentUserId = useRoomStore(state => state.userId);
  const currentNickname = useRoomStore(state => state.nickname);
  const isHost = useRoomStore(state => state.isHost);

  const roomVoiceUsers = useVoiceStore(state => state.roomVoiceUsers);
  const talkingUsers = useVoiceStore(state => state.talkingUsers);
  const isMuted = useVoiceStore(state => state.isMuted);

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

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Voice Chat Section */}
      <div className="p-3 border-b border-border-subtle shrink-0 bg-white/[0.01]">
        <VoiceChat variant="panel" />
      </div>

      <div className="p-3 bg-white/[0.02] font-semibold border-b border-border-subtle shrink-0 flex items-center justify-between text-sm text-gray-200">
        <span className="flex items-center gap-2">
          <Users className="w-4 h-4 text-accent" />
          Участники комнаты
        </span>
        <span className="bg-accent/15 text-accent text-xs px-2.5 py-0.5 rounded-full font-semibold border border-accent/25">
          {displayMembers.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {displayMembers.map(m => {
          const isMe = m.userId === currentUserId;
          return (
            <div
              key={m.userId}
              className={`flex items-center justify-between p-2.5 rounded-xl transition-colors text-sm ${
                isMe
                  ? 'bg-accent/15 border border-accent/30 shadow-sm'
                  : 'bg-white/[0.04] hover:bg-white/[0.08] border border-border-subtle'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    isMe
                      ? 'bg-accent ring-2 ring-accent/30'
                      : 'bg-emerald-500 ring-2 ring-emerald-500/20'
                  }`}
                />
                <span className="truncate text-gray-100 font-medium">
                  {m.nickname}
                </span>
                {isMe && (
                  <span className="text-[11px] text-accent font-semibold bg-accent/20 px-1.5 py-0.5 rounded-md shrink-0">
                    Вы
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {(roomVoiceUsers.has(m.userId) || roomVoiceUsers.has(String(m.userId))) && (
                  (talkingUsers.has(m.userId) || talkingUsers.has(String(m.userId))) ? (
                    <span
                      className="flex items-center gap-1 text-[11px] text-emerald-300 font-medium bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.5 rounded-full animate-pulse"
                      title="Говорит прямо сейчас"
                    >
                      <Volume2 className="w-3 h-3 text-emerald-400" />
                      <span className="hidden sm:inline text-[10px]">Говорит</span>
                    </span>
                  ) : isMe && isMuted ? (
                    <span
                      className="flex items-center text-red-400 bg-red-500/10 border border-red-500/20 p-1 rounded-full text-[11px]"
                      title="Микрофон выключен"
                    >
                      <MicOff className="w-3 h-3" />
                    </span>
                  ) : (
                    <span
                      className="flex items-center text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-1 rounded-full text-[11px]"
                      title="В голосовом чате"
                    >
                      <Mic className="w-3 h-3" />
                    </span>
                  )
                )}
                {m.isHost && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-400 font-medium bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full shrink-0">
                    <Crown className="w-3 h-3" />
                    Хост
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
