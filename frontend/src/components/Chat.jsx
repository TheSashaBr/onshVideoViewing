import { useState, useRef, useEffect } from 'react';
import { useRoomStore } from '../store/roomStore';
import { Send } from 'lucide-react';

export default function Chat({ isOverlay = false, onCloseOverlay = null }) {
  const [text, setText] = useState('');
  const messages = useRoomStore(state => state.chatMessages);
  const sendChat = useRoomStore(state => state.sendChat);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    sendChat(text.trim());
    setText('');
  };

  return (
    <div className={`flex flex-col h-full ${isOverlay ? 'bg-gray-900/95 backdrop-blur shadow-2xl border border-gray-700/60 rounded-xl' : 'bg-gray-900'}`}>
      {/* Header if overlay mode */}
      {isOverlay && (
        <div className="flex items-center justify-between p-3 border-b border-gray-800 bg-gray-800/80 rounded-t-xl shrink-0">
          <span className="font-semibold text-sm text-white flex items-center gap-2">
            💬 Чат трансляции
          </span>
          {onCloseOverlay && (
            <button
              onClick={onCloseOverlay}
              className="text-gray-400 hover:text-white text-xs px-2 py-1 rounded bg-gray-700/50 hover:bg-gray-700 transition"
            >
              Закрыть
            </button>
          )}
        </div>
      )}

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 flex flex-col-reverse select-text">
        <div ref={bottomRef} />
        {messages.length === 0 ? (
          <div className="text-gray-500 text-xs text-center py-6">
            Пока нет сообщений. Начните общение!
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className="text-sm leading-relaxed break-words">
              <span className="font-bold text-blue-400 mr-2 text-xs">
                {msg.nickname}:
              </span>
              <span className="text-gray-200 text-xs sm:text-sm">
                {msg.text}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Message input */}
      <form
        onSubmit={handleSubmit}
        className="p-2.5 sm:p-3 bg-gray-800/90 border-t border-gray-700/70 shrink-0 flex items-center gap-2 pb-safe"
      >
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Написать сообщение..."
          className="flex-1 bg-gray-700/80 hover:bg-gray-700 border border-gray-600/60 rounded-lg px-3.5 py-2 text-base sm:text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white p-2.5 sm:px-4 sm:py-2 rounded-lg font-medium transition-colors flex items-center justify-center shrink-0 active:scale-95"
          aria-label="Отправить"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
