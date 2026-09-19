import { useState, useRef, useEffect } from 'react';
import { useRoomStore } from '../store/roomStore';
import { Send, Smile, ChevronDown, MessageSquare, X } from 'lucide-react';
import VoiceChat from './VoiceChat';

const QUICK_EMOJIS = ['🍿', '🔥', '😂', '❤️', '👍', '😮', '👏', '🎬'];

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10));
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function extractAvatarAndName(nickname = '') {
  const trimmed = nickname.trim();
  const match = trimmed.match(/^(\p{Extended_Pictographic}(?:\u{FE0F})?(?:\u{200D}\p{Extended_Pictographic}(?:\u{FE0F})?)*)\s*(.*)$/u);
  if (match && match[1]) {
    return { avatar: match[1], name: match[2] || trimmed };
  }
  return { avatar: null, name: trimmed };
}

function renderTextWithLinks(text) {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    if (urlRegex.test(part)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-accent-hover hover:text-white break-all transition font-medium"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

export default function Chat({ isOverlay = false, onCloseOverlay = null }) {
  const [text, setText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const messages = useRoomStore(state => state.chatMessages);
  const sendChat = useRoomStore(state => state.sendChat);
  const sendTyping = useRoomStore(state => state.sendTyping);
  const typingUsers = useRoomStore(state => state.typingUsers);
  const currentUserId = useRoomStore(state => state.userId);
  const currentNickname = useRoomStore(state => state.nickname);

  const listContainerRef = useRef(null);
  const bottomRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Check scroll position to determine whether user is looking at older messages
  const handleScroll = () => {
    if (!listContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listContainerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 60;
    setIsAtBottom(atBottom);
    if (atBottom) {
      setUnreadCount(0);
    }
  };

  const scrollToBottom = (smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    setUnreadCount(0);
    setIsAtBottom(true);
  };

  // Scroll to bottom on new messages if already near bottom, else count unread
  const prevMessagesLength = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMessagesLength.current) {
      const lastMsg = messages[messages.length - 1];
      const sentByMe =
        lastMsg &&
        ((lastMsg.userId && String(lastMsg.userId) === String(currentUserId)) ||
          lastMsg.nickname === currentNickname);

      if (isAtBottom || sentByMe) {
        scrollToBottom(true);
      } else {
        setUnreadCount(prev => prev + 1);
      }
    }
    prevMessagesLength.current = messages.length;
  }, [messages, isAtBottom, currentUserId, currentNickname]);

  // Initial scroll to bottom on mount
  useEffect(() => {
    scrollToBottom(false);
  }, []);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setText(val);

    if (val.trim()) {
      if (!typingTimeoutRef.current) {
        sendTyping(true);
      } else {
        clearTimeout(typingTimeoutRef.current);
      }

      typingTimeoutRef.current = setTimeout(() => {
        sendTyping(false);
        typingTimeoutRef.current = null;
      }, 2500);
    } else {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      sendTyping(false);
    }
  };

  const handleSend = (textToSend) => {
    const clean = (textToSend || text).trim();
    if (!clean) return;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    sendTyping(false);
    sendChat(clean);
    setText('');
    setShowEmojiPicker(false);
    scrollToBottom(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    handleSend();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickEmoji = (emoji) => {
    handleSend(emoji);
  };

  // Build typing label from other users
  const activeTypers = Object.entries(typingUsers)
    .filter(([uid]) => uid !== currentUserId)
    .map(([, info]) => info.nickname);

  let typingLabel = '';
  if (activeTypers.length === 1) {
    typingLabel = `${activeTypers[0]} печатает...`;
  } else if (activeTypers.length === 2) {
    typingLabel = `${activeTypers[0]} и ${activeTypers[1]} печатают...`;
  } else if (activeTypers.length > 2) {
    typingLabel = `${activeTypers[0]} и ещё ${activeTypers.length - 1} печатают...`;
  }

  return (
    <div
      className={`flex flex-col h-full relative overflow-hidden ${
        isOverlay
          ? 'bg-surface-raised/95 backdrop-blur-2xl shadow-glass-lg border border-border-medium rounded-3xl'
          : 'bg-surface'
      }`}
    >
      {/* Header if overlay mode */}
      {isOverlay && (
        <div className="flex items-center justify-between p-3 border-b border-border-subtle bg-surface/90 rounded-t-3xl shrink-0 backdrop-blur-md">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-xs text-white flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-accent" />
              <span>Чат</span>
            </span>
            <VoiceChat compact />
          </div>
          {onCloseOverlay && (
            <button
              onClick={onCloseOverlay}
              className="text-gray-400 hover:text-white text-xs p-1 rounded-lg hover:bg-white/[0.08] transition cursor-pointer shrink-0 ml-2"
              title="Закрыть чат"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Messages list */}
      <div
        ref={listContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3.5 space-y-2 select-text"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-10 text-gray-500">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-border-subtle flex items-center justify-center mb-3">
              <MessageSquare className="w-6 h-6 text-accent/60" />
            </div>
            <p className="text-xs font-semibold text-gray-300 mb-1">Здесь пока тихо</p>
            <p className="text-[11px] text-gray-500 max-w-[200px]">
              Начните обсуждение фильма или отправьте реакцию
            </p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isMe =
              (msg.userId && String(msg.userId) === String(currentUserId)) ||
              (msg.senderId && String(msg.senderId) === String(currentUserId)) ||
              (currentNickname && msg.nickname === currentNickname);

            // Grouping logic: check consecutive messages from the same sender within 2 minutes
            const prevMsg = i > 0 ? messages[i - 1] : null;
            const isSameSenderAsPrev =
              prevMsg &&
              ((prevMsg.userId && prevMsg.userId === msg.userId) ||
                prevMsg.nickname === msg.nickname) &&
              Math.abs((msg.ts || 0) - (prevMsg.ts || 0)) < 120000;

            const showHeader = !isSameSenderAsPrev;
            const { avatar, name } = extractAvatarAndName(msg.nickname);
            const timeStr = formatTime(msg.ts);

            return (
              <div
                key={i}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} ${
                  showHeader ? 'mt-2.5 first:mt-0' : 'mt-1'
                }`}
              >
                {/* Sender Nickname & Avatar (only shown on the first message of a group) */}
                {showHeader && (
                  <div
                    className={`flex items-center gap-1.5 mb-1 text-[11px] font-semibold ${
                      isMe ? 'text-accent/90 mr-1' : 'text-gray-300 ml-1'
                    }`}
                  >
                    {avatar && <span>{avatar}</span>}
                    <span>{name}</span>
                    {isMe && (
                      <span className="text-[10px] text-accent/70 font-normal">
                        (Вы)
                      </span>
                    )}
                  </div>
                )}

                {/* Message Bubble */}
                <div
                  className={`relative max-w-[85%] sm:max-w-[78%] px-3.5 py-2 text-xs sm:text-sm leading-relaxed break-words shadow-sm transition-all ${
                    isMe
                      ? 'bg-accent/20 text-white border border-accent/35 rounded-2xl rounded-tr-sm'
                      : 'bg-surface-raised/90 text-gray-100 border border-border-subtle rounded-2xl rounded-tl-sm'
                  }`}
                >
                  <div className="pr-8">{renderTextWithLinks(msg.text)}</div>

                  {/* Timestamp in corner */}
                  {timeStr && (
                    <span
                      className={`absolute bottom-1 right-2 text-[10px] font-mono leading-none select-none ${
                        isMe ? 'text-accent/70' : 'text-gray-500'
                      }`}
                    >
                      {timeStr}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Floating Scroll to Bottom pill */}
      {!isAtBottom && unreadCount > 0 && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-16 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-full shadow-glow-accent text-xs font-semibold animate-scale-in cursor-pointer hover:bg-accent-hover active:scale-95 transition"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          <span>
            {unreadCount > 1 ? `${unreadCount} новых` : 'Новое сообщение'}
          </span>
        </button>
      )}

      {/* Typing indicator */}
      {typingLabel && (
        <div className="px-3.5 py-1 text-[11px] text-gray-400 flex items-center gap-2 shrink-0 bg-white/[0.02] border-t border-border-subtle">
          <span className="flex gap-0.5 items-center">
            <span
              className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </span>
          <span className="italic">{typingLabel}</span>
        </div>
      )}

      {/* Quick emoji reactions bar */}
      {showEmojiPicker && (
        <div className="px-3 py-2 bg-surface-raised/95 border-t border-border-subtle flex items-center gap-1 overflow-x-auto select-none animate-in slide-in-from-bottom-2 duration-150">
          <span className="text-[11px] text-gray-400 mr-1.5 font-medium shrink-0">
            Быстрая реакция:
          </span>
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleQuickEmoji(emoji)}
              className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-white/[0.08] hover:scale-115 active:scale-90 transition text-base cursor-pointer"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Message input form */}
      <form
        onSubmit={handleSubmit}
        className="p-2 sm:p-2.5 bg-surface/90 border-t border-border-subtle shrink-0 flex items-center gap-1.5 pb-safe"
      >
        {/* Toggle emoji reactions */}
        <button
          type="button"
          onClick={() => setShowEmojiPicker((prev) => !prev)}
          className={`p-2 rounded-xl transition cursor-pointer shrink-0 active:scale-95 ${
            showEmojiPicker
              ? 'bg-accent/20 text-accent border border-accent/30'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.05]'
          }`}
          title="Быстрые эмодзи"
        >
          <Smile className="w-4 h-4" />
        </button>

        <input
          type="text"
          value={text}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Написать в чат..."
          maxLength={500}
          className="flex-1 bg-white/[0.04] hover:bg-white/[0.07] focus:bg-white/[0.06] border border-border-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 rounded-xl px-3.5 py-2 text-sm text-white placeholder-gray-500 outline-none transition"
        />

        <button
          type="submit"
          disabled={!text.trim()}
          className="bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white p-2 sm:px-3.5 sm:py-2 rounded-xl font-medium transition-all shadow-glow-accent flex items-center justify-center shrink-0 active:scale-95 cursor-pointer"
          aria-label="Отправить"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
