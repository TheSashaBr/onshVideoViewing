import React from 'react';
import { useVoiceStore } from '../store/voiceStore';
import { useRoomStore } from '../store/roomStore';
import { Mic, MicOff, PhoneCall, PhoneOff, Loader2, Volume2, Radio, RefreshCw, Video, VideoOff } from 'lucide-react';
import { cn } from '../utils/cn';

// Animated audio frequency equalizer bars
export function VoiceEqualizer({ className = '', barClassName = 'bg-emerald-400' }) {
  return (
    <div
      className={cn('inline-flex items-end gap-[2.5px] h-3.5 px-0.5 select-none', className)}
      aria-label="Идёт речь"
    >
      <span className={cn('w-[2.5px] rounded-full animate-equalize-1', barClassName)} />
      <span className={cn('w-[2.5px] rounded-full animate-equalize-2', barClassName)} />
      <span className={cn('w-[2.5px] rounded-full animate-equalize-3', barClassName)} />
      <span className={cn('w-[2.5px] rounded-full animate-equalize-4', barClassName)} />
    </div>
  );
}

export default function VoiceChat({ variant = 'pill', compact = false }) {
  const isInVoice = useVoiceStore(state => state.isInVoice);
  const isMuted = useVoiceStore(state => state.isMuted);
  const isConnecting = useVoiceStore(state => state.isConnecting);
  const audioBlocked = useVoiceStore(state => state.audioBlocked);
  const peerConnectionStates = useVoiceStore(state => state.peerConnectionStates);
  const roomVoiceUsers = useVoiceStore(state => state.roomVoiceUsers);
  const talkingUsers = useVoiceStore(state => state.talkingUsers);
  const joinVoice = useVoiceStore(state => state.joinVoice);
  const leaveVoice = useVoiceStore(state => state.leaveVoice);
  const toggleMute = useVoiceStore(state => state.toggleMute);
  const unlockAudioPlayback = useVoiceStore(state => state.unlockAudioPlayback);
  const retryPeerConnection = useVoiceStore(state => state.retryPeerConnection);
  const isCameraOn = useVoiceStore(state => state.isCameraOn);
  const isCameraConnecting = useVoiceStore(state => state.isCameraConnecting);
  const toggleCamera = useVoiceStore(state => state.toggleCamera);

  const members = useRoomStore(state => state.members);
  const currentUserId = useRoomStore(state => state.userId);

  const voiceCount = Math.max(roomVoiceUsers.size, isInVoice ? 1 : 0);
  const isMeSpeaking = currentUserId && (talkingUsers.has(currentUserId) || talkingUsers.has(String(currentUserId)));

  // Extract avatar character or emoji
  const getAvatarChar = (nick = '') => {
    const trimmed = nick.trim();
    const match = trimmed.match(/^\p{Extended_Pictographic}/u);
    return match ? match[0] : (trimmed[0] || '?').toUpperCase();
  };

  // Clean nickname without leading emoji
  const getCleanNick = (nick = '') => {
    return nick.replace(/^\p{Extended_Pictographic}\s*/u, '').trim() || nick;
  };

  // ==========================================
  // VARIANT: PANEL (Inside Members sidebar)
  // ==========================================
  if (variant === 'panel') {
    if (!isInVoice) {
      return (
        <section
          aria-label="Голосовой чат комнаты"
          className="bg-gradient-to-b from-emerald-950/30 to-surface-raised/80 border border-emerald-500/25 rounded-2xl p-3.5 shadow-glass"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-sm">
                <Radio className="w-4 h-4 text-emerald-400 animate-pulse-subtle" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-white tracking-wide">Голосовой чат</h3>
                <p className="text-[11px] text-gray-400">
                  {voiceCount > 0 ? `${voiceCount} в звонке прямо сейчас` : 'В звонке пока никого нет'}
                </p>
              </div>
            </div>

            {voiceCount > 0 && (
              <span className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {voiceCount}
              </span>
            )}
          </div>

          {/* Active Voice Participants Preview */}
          {voiceCount > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3 p-2 bg-emerald-950/40 rounded-xl border border-emerald-500/20">
              {Array.from(roomVoiceUsers).map(uid => {
                const m = members.find(mem => String(mem.userId) === String(uid));
                const nick = m ? getCleanNick(m.nickname) : 'Участник';
                const av = m ? getAvatarChar(m.nickname) : '🎤';
                return (
                  <span
                    key={uid}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-[11px] font-medium border border-emerald-500/30"
                  >
                    <span>{av}</span>
                    <span className="truncate max-w-[120px]">{nick}</span>
                  </span>
                );
              })}
            </div>
          )}

          <button
            onClick={joinVoice}
            disabled={isConnecting}
            aria-label="Войти в голосовой чат"
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 active:scale-[0.98] text-white font-semibold text-xs rounded-xl transition-all shadow-md shadow-emerald-950/40 cursor-pointer disabled:opacity-60"
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Подключение к аудиоканалу...</span>
              </>
            ) : (
              <>
                <PhoneCall className="w-3.5 h-3.5" />
                <span>Войти в голосовой чат</span>
              </>
            )}
          </button>
        </section>
      );
    }

    // In Voice - Panel mode
    const voiceMembersMap = new Map();
    members.forEach(m => {
      if (roomVoiceUsers.has(String(m.userId)) || roomVoiceUsers.has(m.userId)) {
        voiceMembersMap.set(String(m.userId), m);
      }
    });

    // Ensure all users in roomVoiceUsers are displayed, even if members list is still updating
    roomVoiceUsers.forEach(uid => {
      const uidStr = String(uid);
      if (!voiceMembersMap.has(uidStr)) {
        const found = members.find(m => String(m.userId) === uidStr);
        if (found) {
          voiceMembersMap.set(uidStr, found);
        } else if (uidStr === String(currentUserId)) {
          voiceMembersMap.set(uidStr, {
            userId: uidStr,
            nickname: useRoomStore.getState().nickname || 'Вы',
            isHost: useRoomStore.getState().isHost,
            joinedAt: Date.now()
          });
        } else {
          voiceMembersMap.set(uidStr, {
            userId: uidStr,
            nickname: 'Участник',
            isHost: false,
            joinedAt: Date.now()
          });
        }
      }
    });

    if (isInVoice && currentUserId && !voiceMembersMap.has(String(currentUserId))) {
      voiceMembersMap.set(String(currentUserId), {
        userId: currentUserId,
        nickname: useRoomStore.getState().nickname || 'Вы',
        isHost: useRoomStore.getState().isHost,
        joinedAt: Date.now()
      });
    }
    const voiceMembers = Array.from(voiceMembersMap.values());

    return (
      <section
        aria-label="Активный голосовой чат"
        className="bg-gradient-to-b from-emerald-950/50 via-surface-raised/90 to-surface-raised/70 border border-emerald-500/35 rounded-2xl p-3.5 shadow-glass-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="text-xs font-bold text-emerald-400 tracking-wide">
              В эфире ({voiceCount})
            </span>
          </div>

          {isMeSpeaking && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[10px] text-emerald-300 font-semibold animate-pulse">
              <VoiceEqualizer barClassName="bg-emerald-300" />
              <span>Вы говорите</span>
            </div>
          )}
        </div>

        {/* Audio Blocked Alert Banner (iOS / Browser autoplay restriction) */}
        {audioBlocked && (
          <button
            onClick={unlockAudioPlayback}
            className="w-full mb-2.5 py-2 px-3 bg-amber-500/20 hover:bg-amber-500/30 active:scale-[0.98] border border-amber-400/50 rounded-xl text-amber-300 text-xs font-semibold flex items-center justify-center gap-2 animate-pulse cursor-pointer shadow-sm"
          >
            <Volume2 className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Звук заблокирован. Нажмите сюда, чтобы включить</span>
          </button>
        )}

        {/* Voice Participants List */}
        <div className="space-y-1.5 mb-3 max-h-44 overflow-y-auto pr-1">
          {voiceMembers.map(m => {
            const isMe = String(m.userId) === String(currentUserId);
            const isTalking = talkingUsers.has(m.userId) || talkingUsers.has(String(m.userId));
            const avatarChar = getAvatarChar(m.nickname);
            const cleanNick = getCleanNick(m.nickname);
            const connState = peerConnectionStates[m.userId] || 'connecting';

            return (
              <div
                key={m.userId}
                className={cn(
                  'flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs transition-all border',
                  isTalking
                    ? 'bg-emerald-500/20 border-emerald-400/50 shadow-glow-voice ring-1 ring-emerald-400/30'
                    : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]'
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={cn(
                      'w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 transition-colors',
                      isTalking
                        ? 'bg-emerald-500 text-black shadow-sm'
                        : 'bg-white/[0.08] text-gray-200'
                    )}
                  >
                    {avatarChar}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="truncate font-medium text-gray-200 text-xs">
                      {cleanNick} {isMe && <span className="text-accent text-[10px] font-semibold">(вы)</span>}
                    </span>
                    {!isMe && (
                      <span className="text-[10px] text-gray-400 flex items-center gap-1">
                        {connState === 'connected' ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            в сети
                          </span>
                        ) : connState === 'failed' ? (
                          <span className="text-red-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                            сбой связи
                          </span>
                        ) : (
                          <span className="text-amber-300 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            подключение...
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {isTalking ? (
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold">
                      <VoiceEqualizer barClassName="bg-emerald-400" />
                      <span className="hidden sm:inline">говорит</span>
                    </div>
                  ) : isMe && isMuted ? (
                    <span className="p-1 rounded-md bg-red-500/20 text-red-400" title="Микрофон выключен">
                      <MicOff className="w-3 h-3" />
                    </span>
                  ) : !isMe && connState === 'failed' ? (
                    <button
                      onClick={() => retryPeerConnection(m.userId)}
                      className="p-1 rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-300 transition cursor-pointer"
                      title="Переподключить участника"
                      aria-label="Переподключить участника"
                    >
                      <RefreshCw className="w-3 h-3 animate-spin-once" />
                    </button>
                  ) : (
                    <span className="p-1 rounded-md text-gray-400" title="В звонке">
                      <Mic className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 pt-1 border-t border-white/[0.06]">
          {/* Mute toggle button */}
          <button
            onClick={toggleMute}
            aria-pressed={isMuted}
            aria-label={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold transition active:scale-[0.98] cursor-pointer border',
              isMuted
                ? 'bg-red-500/20 text-red-300 border-red-500/40 hover:bg-red-500/30'
                : isMeSpeaking
                ? 'bg-emerald-500/30 text-emerald-200 border-emerald-400/60 shadow-glow-voice'
                : 'bg-white/[0.06] text-gray-200 border-white/[0.1] hover:bg-white/[0.12]'
            )}
          >
            {isMuted ? (
              <>
                <MicOff className="w-3.5 h-3.5 text-red-400" />
                <span>Микрофон выкл</span>
              </>
            ) : isMeSpeaking ? (
              <>
                <VoiceEqualizer barClassName="bg-emerald-300" />
                <span>Вы говорите</span>
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5 text-emerald-400" />
                <span>Микрофон вкл</span>
              </>
            )}
          </button>

          {/* Camera toggle button */}
          <button
            onClick={toggleCamera}
            disabled={isCameraConnecting}
            aria-pressed={isCameraOn}
            aria-label={isCameraOn ? 'Выключить камеру' : 'Включить камеру'}
            className={cn(
              'flex items-center justify-center p-2 rounded-xl transition active:scale-95 cursor-pointer border disabled:opacity-60',
              isCameraOn
                ? 'bg-accent/25 text-accent border-accent/40 hover:bg-accent/35'
                : 'bg-white/[0.06] text-gray-200 border-white/[0.1] hover:bg-white/[0.12]'
            )}
            title={isCameraOn ? 'Выключить камеру' : 'Включить камеру'}
          >
            {isCameraConnecting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isCameraOn ? (
              <Video className="w-3.5 h-3.5" />
            ) : (
              <VideoOff className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Leave call button */}
          <button
            onClick={leaveVoice}
            aria-label="Отключиться от голосового чата"
            className="flex items-center gap-1.5 py-2 px-3.5 bg-red-600/80 hover:bg-red-600 active:scale-[0.98] text-white font-semibold text-xs rounded-xl transition cursor-pointer shadow-sm shadow-red-950/40"
            title="Отключиться от звонка"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span>Выйти</span>
          </button>
        </div>
      </section>
    );
  }

  // ==========================================
  // VARIANT: PILL (Header & Cinema Mode Top Bar)
  // ==========================================
  if (!isInVoice) {
    return (
      <button
        onClick={joinVoice}
        disabled={isConnecting}
        aria-label="Войти в голосовой чат"
        className={cn(
          'flex items-center gap-1.5 transition-all duration-200 active:scale-95 cursor-pointer font-semibold text-xs rounded-xl shadow-sm border border-emerald-500/30',
          'px-2.5 sm:px-3 py-1.5 bg-emerald-600/90 hover:bg-emerald-500 text-white shadow-emerald-950/40',
          isConnecting && 'opacity-70 cursor-wait'
        )}
        title="Войти в голосовой чат"
      >
        {isConnecting ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="hidden sm:inline">Подключение...</span>
          </>
        ) : (
          <>
            <PhoneCall className="w-3.5 h-3.5 text-white" />
            <span>{compact ? 'Голос' : 'Голосовой чат'}</span>
            {voiceCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-emerald-900/80 text-emerald-200 border border-emerald-400/30">
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
    <div
      role="region"
      aria-label="Контролы голосового чата"
      className="flex items-center gap-1 sm:gap-1.5 bg-surface-raised/95 backdrop-blur-xl border border-emerald-500/40 px-1.5 sm:px-2 py-1 rounded-xl shadow-glass transition-all"
    >
      {/* Speaking / Audio Status Indicator */}
      <div
        className={cn(
          'flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs transition-colors',
          isMeSpeaking
            ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/50 shadow-sm'
            : 'text-gray-300'
        )}
        title={isMuted ? 'Микрофон выключен' : isMeSpeaking ? 'Вы говорите' : 'Микрофон включен'}
      >
        {isMeSpeaking ? (
          <VoiceEqualizer barClassName="bg-emerald-400" />
        ) : (
          <span
            className={cn(
              'w-2 h-2 rounded-full transition-all',
              isMuted ? 'bg-red-500' : 'bg-emerald-500'
            )}
          />
        )}
        {!compact && (
          <span className="text-[11px] font-semibold hidden sm:inline text-emerald-400">
            {isMeSpeaking ? 'В эфире' : `В эфире (${voiceCount})`}
          </span>
        )}
      </div>

      {/* Mute/Unmute Mic Toggle */}
      <button
        onClick={toggleMute}
        aria-pressed={isMuted}
        aria-label={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
        className={cn(
          'p-1.5 rounded-lg transition active:scale-95 cursor-pointer border',
          isMuted
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/40'
            : isMeSpeaking
            ? 'bg-emerald-500/30 text-emerald-300 border-emerald-400/60 shadow-glow-voice'
            : 'bg-white/[0.08] text-gray-200 hover:bg-white/[0.15] border-white/[0.08]'
        )}
        title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
      >
        {isMuted ? (
          <MicOff className="w-3.5 h-3.5 text-red-400" />
        ) : (
          <Mic className="w-3.5 h-3.5 text-emerald-400" />
        )}
      </button>

      {/* Camera Toggle */}
      <button
        onClick={toggleCamera}
        disabled={isCameraConnecting}
        aria-pressed={isCameraOn}
        aria-label={isCameraOn ? 'Выключить камеру' : 'Включить камеру'}
        className={cn(
          'p-1.5 rounded-lg transition active:scale-95 cursor-pointer border disabled:opacity-60',
          isCameraOn
            ? 'bg-accent/25 text-accent border-accent/40 hover:bg-accent/35'
            : 'bg-white/[0.08] text-gray-200 hover:bg-white/[0.15] border-white/[0.08]'
        )}
        title={isCameraOn ? 'Выключить камеру' : 'Включить камеру'}
      >
        {isCameraConnecting ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isCameraOn ? (
          <Video className="w-3.5 h-3.5" />
        ) : (
          <VideoOff className="w-3.5 h-3.5" />
        )}
      </button>

      {/* Unblock audio if browser policy prevented autoplay */}
      {audioBlocked && (
        <button
          onClick={unlockAudioPlayback}
          aria-label="Включить звук"
          className="p-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 transition active:scale-95 cursor-pointer border border-amber-400/50 animate-pulse"
          title="Нажмите, чтобы включить звук"
        >
          <Volume2 className="w-3.5 h-3.5 text-amber-400" />
        </button>
      )}

      {/* Leave Voice Button */}
      <button
        onClick={leaveVoice}
        aria-label="Отключиться от голосового чата"
        className="p-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white transition active:scale-95 cursor-pointer shadow-sm border border-red-500/30"
        title="Отключиться от голосового чата"
      >
        <PhoneOff className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
