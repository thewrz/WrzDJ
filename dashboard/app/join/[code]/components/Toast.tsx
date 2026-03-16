'use client';

import { useEffect } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'info' | 'warning';
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 4000;

export default function Toast({ message, type, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const colors = {
    success: { bg: 'rgba(34, 197, 94, 0.9)', color: '#fff' },
    info: { bg: 'rgba(59, 130, 246, 0.9)', color: '#fff' },
    warning: { bg: 'rgba(234, 179, 8, 0.9)', color: '#000' },
  };

  const { bg, color } = colors[type];

  return (
    <div
      className="toast-notification"
      style={{ background: bg, color }}
      onClick={onDismiss}
      role="alert"
    >
      {message}
    </div>
  );
}
