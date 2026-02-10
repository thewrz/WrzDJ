'use client';

interface TidalLoginModalProps {
  loginUrl: string;
  userCode: string;
  polling: boolean;
  onCancel: () => void;
}

export function TidalLoginModal({
  loginUrl,
  userCode,
  polling,
  onCancel,
}: TidalLoginModalProps) {
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
    >
      <div
        className="card"
        style={{ maxWidth: '400px', margin: '1rem', textAlign: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: '1rem' }}>Connect Tidal</h2>
        <p style={{ color: '#9ca3af', marginBottom: '1.5rem' }}>
          Visit the link below and enter the code to connect your Tidal account:
        </p>
        <a
          href={loginUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            padding: '0.75rem',
            background: '#0066ff',
            color: 'white',
            borderRadius: '0.5rem',
            textDecoration: 'none',
            marginBottom: '1rem',
            fontWeight: 500,
          }}
        >
          Open Tidal Login
        </a>
        <div
          style={{
            padding: '1rem',
            background: '#1a1a1a',
            borderRadius: '0.5rem',
            marginBottom: '1.5rem',
          }}
        >
          <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
            Your code:
          </p>
          <p style={{ fontSize: '1.5rem', fontWeight: 'bold', letterSpacing: '0.25rem' }}>
            {userCode}
          </p>
        </div>
        {polling && (
          <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Waiting for authorization...
          </p>
        )}
        <button
          className="btn"
          style={{ background: '#333' }}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
