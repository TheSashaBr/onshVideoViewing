import { useState, useCallback, useEffect, useRef } from 'react';
import Toast from './Toast';

let addToastGlobal = null;

export function showToast(message, type = 'info', duration = 3000) {
  addToastGlobal?.(message, type, duration);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = ++idRef.current;
    // Show up to 4 toasts stacked neatly
    setToasts(prev => [...prev.slice(-3), { id, message, type, duration }]);
  }, []);

  useEffect(() => {
    addToastGlobal = addToast;
    return () => { addToastGlobal = null; };
  }, [addToast]);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <div
      aria-live="polite"
      aria-label="Уведомления"
      className="fixed top-3 sm:top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2.5 w-full max-w-sm sm:max-w-md px-3 pointer-events-none pt-safe"
    >
      {toasts.map(t => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          duration={t.duration}
          onClose={() => removeToast(t.id)}
        />
      ))}
    </div>
  );
}
