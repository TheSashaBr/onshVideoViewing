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
    <div className="flex flex-col h-full bg-[#0a0a0f]">
      {/* Voice Chat Section */}
      <div className="p-3 border-b border-white/[0.06] shrink-0 bg-white/[0.01]">
        <VoiceChat variant="panel" />
      </div>

      <div className="p-3 bg-white/[0.03] font-semibold border-b border-white/[0.06] shrink-0 flex items-center justify-between text-sm text-gray-200">
        <span className="flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-400" />
          Участники комнаты
        </span>
        <span className="bg-blue-600/30 text-blue-300 text-xs px-2 py-0.5 rounded-full font-medium">
          {displayMembers.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {displayMembers.map(m => {
          const isMe = m.userId === currentUserId;
          return (
            <div
              key={m.userId}
              className={`flex items-center justify-between p-2 rounded-lg transition-colors text-sm ${
                isMe
                  ? 'bg-blue-950/40 border border-blue-800/40'
                  : 'bg-gray-800/40 hover:bg-gray-800/80'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    isMe
                      ? 'bg-blue-400 ring-2 ring-blue-400/30'
                      : 'bg-emerald-500 ring-2 ring-emerald-500/20'
                  }`}
                />
                <span className="truncate text-gray-100 font-medium">
                  {m.nickname}
                </span>
                {isMe && (
                  <span className="text-[11px] text-blue-300 font-semibold bg-blue-500/20 px-1.5 py-0.5 rounded shrink-0">
                    Вы
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {roomVoiceUsers.has(m.userId) && (
                  talkingUsers.has(m.userId) ? (
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
