'use client';

interface ModalOverlayProps {
  children: React.ReactNode;
  onClose?: () => void;
}

export function ModalOverlay({ children, onClose }: ModalOverlayProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: '400px', margin: '1rem' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
