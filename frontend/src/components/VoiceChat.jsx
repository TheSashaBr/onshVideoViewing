import { useVoiceStore } from '../store/voiceStore';
import { useRoomStore } from '../store/roomStore';
import { Mic, MicOff, PhoneCall, PhoneOff, Loader2, Volume2, Users } from 'lucide-react';

export default function VoiceChat({ variant = 'pill', compact = false }) {
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
  const speakingList = members.filter(m => talkingUsers.has(m.userId));
  const isMeSpeaking = currentUserId && talkingUsers.has(currentUserId);

  // Variant: 'panel' - Full-width dedicated widget inside Members tab / sidebar
  if (variant === 'panel') {
    if (!isInVoice) {
      return (
        <div className="bg-gradient-to-r from-emerald-950/40 via-gray-900/60 to-emerald-950/20 border border-emerald-500/30 rounded-xl p-3 shadow-md">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <PhoneCall className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="text-xs font-semibold text-white block">Голосовой чат</span>
                <span className="text-[11px] text-gray-400 block">
                  {voiceCount > 0 ? `${voiceCount} в звонке` : 'Комната свободна'}
                </span>
              </div>
            </div>
            {voiceCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {voiceCount}
              </span>
            )}
          </div>

          <button
            onClick={joinVoice}
            disabled={isConnecting}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-medium text-xs rounded-lg transition-all shadow-md shadow-emerald-900/30 cursor-pointer disabled:opacity-60"
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Подключение к звонку...</span>
              </>
            ) : (
              <>
                <PhoneCall className="w-3.5 h-3.5" />
                <span>Войти в голосовой чат</span>
              </>
            )}
          </button>
        </div>
      );
    }

    // In Voice - Panel mode
    return (
      <div className="bg-gradient-to-r from-emerald-950/60 via-gray-900/80 to-emerald-950/40 border border-emerald-500/40 rounded-xl p-3 shadow-lg">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold text-emerald-400">
              Вы в звонке ({voiceCount})
            </span>
          </div>

          {speakingList.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-300 font-medium">
              <Volume2 className="w-3 h-3 text-emerald-400 animate-pulse" />
              <span className="truncate max-w-[120px]">
                {speakingList.map(s => s.userId === currentUserId ? 'Вы' : s.nickname).join(', ')}
              </span>
            </span>
          )}
        </div>

        {/* List of active participants in this voice call */}
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {members
            .filter(m => roomVoiceUsers.has(String(m.userId)) || roomVoiceUsers.has(m.userId))
            .map(m => {
              const isMe = m.userId === currentUserId;
              const isTalking = talkingUsers.has(m.userId);
              return (
                <div
                  key={m.userId}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs transition-all ${
                    isTalking
                      ? 'bg-emerald-500/30 text-emerald-200 ring-1 ring-emerald-400/50 shadow-sm'
                      : 'bg-white/[0.06] text-gray-300'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isTalking
                        ? 'bg-emerald-400 animate-pulse'
                        : isMe && isMuted
                        ? 'bg-red-500'
                        : 'bg-emerald-500'
                    }`}
                  />
                  <span className="font-medium truncate max-w-[100px]">
                    {isMe ? 'Вы' : m.nickname}
                  </span>
                  {isTalking && (
                    <Volume2 className="w-3 h-3 text-emerald-400 animate-pulse" />
                  )}
                </div>
              );
            })}
        </div>

        <div className="flex items-center gap-2">
          {/* Mute button */}
          <button
            onClick={toggleMute}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition active:scale-[0.98] cursor-pointer ${
              isMuted
                ? 'bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30'
                : isMeSpeaking
                ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/60 ring-2 ring-emerald-400/30'
                : 'bg-white/[0.08] text-gray-200 border border-white/[0.1] hover:bg-white/[0.15]'
            }`}
          >
            {isMuted ? (
              <>
                <MicOff className="w-3.5 h-3.5 text-red-400" />
                <span>Микрофон выкл</span>
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isMeSpeaking ? 'Вы говорите' : 'Микрофон вкл'}</span>
              </>
            )}
          </button>

          {/* Leave call button */}
          <button
            onClick={leaveVoice}
            className="flex items-center gap-1 py-1.5 px-3 bg-red-600/80 hover:bg-red-600 active:scale-[0.98] text-white font-medium text-xs rounded-lg transition cursor-pointer shadow-sm"
            title="Выйти из звонка"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span>Выйти</span>
          </button>
        </div>
      </div>
    );
  }

  // Variant: 'pill' - Header & Cinema Mode Top Bar
  if (!isInVoice) {
    return (
      <button
        onClick={joinVoice}
        disabled={isConnecting}
        className={`flex items-center gap-1.5 transition-all duration-200 active:scale-95 cursor-pointer font-medium text-xs rounded-xl shadow-sm ${
          compact
            ? 'px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/40'
            : 'px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/40'
        } ${isConnecting ? 'opacity-70 cursor-wait' : ''}`}
        title="Войти в голосовой чат"
      >
        {isConnecting ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Подключение...</span>
          </>
        ) : (
          <>
            <PhoneCall className="w-3.5 h-3.5" />
            <span>{compact ? 'Голос' : 'Голосовой чат'}</span>
            {voiceCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-emerald-900/60 text-white">
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
    <div className="flex items-center gap-1 sm:gap-1.5 bg-gray-900/90 backdrop-blur-md border border-emerald-500/40 px-1.5 sm:px-2 py-1 rounded-xl shadow-lg transition-all">
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
          <MicOff className="w-3.5 h-3.5 text-red-400" />
        ) : (
          <Mic className="w-3.5 h-3.5 text-emerald-400" />
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
