import { useState, useEffect } from 'react';
import { Sparkles, X, Search } from 'lucide-react';
import { useRoomStore } from '../store/roomStore';

// ids must match TOPICS in backend/src/services/youtubeShorts.js
const TOPICS = [
  { id: 'trends', emoji: '🔥', label: 'Тренды' },
  { id: 'memes', emoji: '😂', label: 'Мемы' },
  { id: 'animals', emoji: '🐱', label: 'Животные' },
  { id: 'games', emoji: '🎮', label: 'Игры' },
  { id: 'sport', emoji: '⚽', label: 'Спорт' },
  { id: 'music', emoji: '🎵', label: 'Музыка' },
  { id: 'food', emoji: '🍔', label: 'Еда' },
  { id: 'facts', emoji: '🤯', label: 'Факты' },
];

export default function FeedTopicPicker({ open, onClose }) {
  const startFeed = useRoomStore(state => state.startFeed);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const pick = (params) => {
    startFeed(params);
    setQuery('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-10 sm:pt-16 p-4 overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="feed-topic-picker-title"
    >
      <div
        className="relative bg-surface-raised/95 border border-border-medium p-5 sm:p-6 rounded-3xl max-w-md w-full shadow-glass-lg backdrop-blur-xl animate-in slide-in-from-top-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" />
            <h3 id="feed-topic-picker-title" className="text-white text-base font-bold">
              Лента Shorts
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.08] transition cursor-pointer"
            aria-label="Закрыть выбор темы"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-gray-400 text-xs mb-4">
          Короткие ролики подгружаются сами и идут у всех одновременно. Выберите тему:
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {TOPICS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => pick({ topic: t.id })}
              className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-white/[0.04] hover:bg-accent/15 active:scale-95 border border-border-subtle hover:border-accent/40 text-gray-200 text-xs font-semibold transition cursor-pointer"
            >
              <span className="text-xl leading-none">{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) pick({ query: query.trim() });
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1 flex items-center">
            <Search className="absolute left-3 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={60}
              enterKeyHint="search"
              aria-label="Своя тема ленты"
              placeholder="Своя тема, например «котики»"
              className="w-full bg-surface border border-border-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition"
            />
          </div>
          <button
            type="submit"
            disabled={!query.trim()}
            className="px-4 py-2.5 text-xs font-semibold bg-accent hover:bg-accent-hover text-white rounded-xl transition shadow-glow-accent disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Смотреть
          </button>
        </form>
      </div>
    </div>
  );
}
