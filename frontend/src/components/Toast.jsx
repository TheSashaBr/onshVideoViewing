import { useEffect, useState } from 'react';

export default function Toast({ message, type = 'info', duration = 3000, onClose }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onClose?.(), 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const colors = {
    info: 'bg-blue-600/90 border-blue-400/30',
    success: 'bg-emerald-600/90 border-emerald-400/30',
    warning: 'bg-yellow-600/90 border-yellow-400/30',
    error: 'bg-red-600/90 border-red-400/30',
  };

  return (
    <div
      className={`px-4 py-2.5 rounded-xl text-white text-xs font-medium border backdrop-blur-md shadow-xl transition-all duration-300 ${
        colors[type] || colors.info
      } ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
    >
      {message}
    </div>
  );
}
