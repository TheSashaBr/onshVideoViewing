import { useVoiceStore } from '../store/voiceStore';
import { useRoomStore } from '../store/roomStore';
import { Mic, MicOff, PhoneCall, PhoneOff, Loader2, Volume2 } from 'lucide-react';

export default function VoiceChat({ compact = false }) {
  const isInVoice = useVoiceStore(state => state.isInVoice);
  const isMuted = useVoiceStore(state => state.isMuted);
  const isConnecting = useVoiceStore(state => state.isConnecting);
  const roomVoiceUsers = useVoiceStore(state => state.roomVoiceUsers);
  const talkingUsers = useVoiceStore(state => state.talkingUsers);
  const joinVoice = useVoiceStore(state => state.joinVoice);
  const leaveVoice = useVoiceStore(state => state.leaveVoice);
  const toggleMute = useVoiceStore(state => state.toggleMute);

  const members = useRoomStore(state => state.members);
  const currentUserId = useRoomStore(state => state.userId);

  const voiceCount = roomVoiceUsers.size;

  // Find who is currently speaking among active talking users
  const speakingList = members.filter(m => talkingUsers.has(m.userId));
  const isMeSpeaking = currentUserId && talkingUsers.has(currentUserId);

  if (!isInVoice) {
    return (
      <button
        onClick={joinVoice}
        disabled={isConnecting}
        className={`flex items-center gap-1.5 transition-all duration-200 active:scale-95 cursor-pointer font-medium text-xs rounded-xl ${
          compact
            ? 'px-2.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30'
            : 'px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 shadow-sm'
        } ${isConnecting ? 'opacity-70 cursor-wait' : ''}`}
        title="Войти в голосовой чат"
      >
        {isConnecting ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            <span>Подключение...</span>
          </>
        ) : (
          <>
            <PhoneCall className="w-3.5 h-3.5 text-emerald-400" />
            <span>{compact ? 'Голос' : 'Голосовой чат'}</span>
            {voiceCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-emerald-500/30 text-emerald-300 border border-emerald-500/40">
                {voiceCount}
              </span>
            )}
          </>
        )}
      </button>
    );
  }

  // Active Voice Call Pill Controls
  return (
    <div className="flex items-center gap-1 sm:gap-1.5 bg-white/[0.06] backdrop-blur-md border border-emerald-500/30 px-1.5 sm:px-2 py-1 rounded-xl shadow-lg transition-all">
      {/* Speaking / Audio Status Indicator */}
      <div
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs transition-colors ${
          isMeSpeaking
            ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/50'
            : 'text-gray-300'
        }`}
        title={isMuted ? 'Микрофон выключен' : isMeSpeaking ? 'Вы говорите' : 'Микрофон включен'}
      >
        <span
          className={`w-2 h-2 rounded-full transition-all ${
            isMeSpeaking
              ? 'bg-emerald-400 animate-ping'
              : isMuted
              ? 'bg-red-500'
              : 'bg-emerald-500'
          }`}
        />
        {!compact && (
          <span className="text-[11px] font-medium hidden sm:inline text-emerald-400">
            В эфире ({voiceCount})
          </span>
        )}
      </div>

      {/* Mute/Unmute Mic Toggle */}
      <button
        onClick={toggleMute}
        className={`p-1.5 rounded-lg transition active:scale-95 cursor-pointer ${
          isMuted
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/40'
            : isMeSpeaking
            ? 'bg-emerald-500/30 text-emerald-300 ring-2 ring-emerald-400/40'
            : 'bg-white/[0.08] text-gray-200 hover:bg-white/[0.15]'
        }`}
        title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
      >
        {isMuted ? (
          <MicOff className="w-3.5 h-3.5" />
        ) : (
          <Mic className="w-3.5 h-3.5" />
        )}
      </button>

      {/* Leave Voice Button */}
      <button
        onClick={leaveVoice}
        className="p-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white transition active:scale-95 cursor-pointer shadow-sm"
        title="Отключиться от голосового чата"
      >
        <PhoneOff className="w-3.5 h-3.5" />
      </button>

      {/* Subtle indicator of someone speaking */}
      {speakingList.length > 0 && !compact && (
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-emerald-300 pl-1 border-l border-white/10">
          <Volume2 className="w-3 h-3 text-emerald-400 animate-pulse" />
          <span className="truncate max-w-[100px]">
            {speakingList.map(s => s.userId === currentUserId ? 'Вы' : s.nickname).join(', ')}
          </span>
        </div>
      )}
    </div>
  );
}
