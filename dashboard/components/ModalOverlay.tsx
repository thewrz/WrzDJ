'use client';

import type { CSSProperties, ReactNode } from 'react';

interface ModalOverlayProps {
  children: ReactNode;
  /** Called when the user clicks the backdrop. Pass undefined to disable dismiss-on-backdrop. */
  onClose?: () => void;
  /**
   * When true, wraps children in a `.card` with max-width 400px — used by small
   * confirmation + login modals. When false (default), children supply their own
   * container (`.modal`, wider panels, etc.).
   */
  card?: boolean;
  /** Extra className merged onto the overlay div, e.g. 'keyboard-overlay-active'. */
  className?: string;
  /** Override style for the inner container (card mode only). */
  cardStyle?: CSSProperties;
}

/**
 * Shared full-viewport overlay for modals. Backdrop click calls `onClose`; inner
 * content stops propagation automatically so clicks inside don't dismiss.
 *
 * Styling comes from the `.modal-overlay` CSS class in globals.css.
 */
export function ModalOverlay({
  children,
  onClose,
  card = false,
  className = '',
  cardStyle,
}: ModalOverlayProps) {
  const classes = className ? `modal-overlay ${className}` : 'modal-overlay';
  if (card) {
    return (
      <div className={classes} onClick={onClose}>
        <div
          className="card"
          style={{ maxWidth: '400px', margin: '1rem', ...cardStyle }}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    );
  }
  // Non-card mode: caller's children supply their own `.modal` wrapper (or similar)
  // with their own stopPropagation. The overlay just provides the backdrop + dismiss.
  return (
    <div className={classes} onClick={onClose}>
      {children}
    </div>
  );
}
