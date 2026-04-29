'use client';

const ACCENT = '#00f0ff';
const ACCENT2 = '#ff2bd6';

interface Props {
  used: number;
  cap: number;
  onOpenSearch: () => void;
}

export default function SubmitBar({ used, cap, onOpenSearch }: Props) {
  const atCap = cap !== 0 && used >= cap;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
      padding: '12px 12px calc(12px + env(safe-area-inset-bottom, 0px))',
      background: 'linear-gradient(transparent, #06060a 35%)',
    }}>
      <button
        type="button"
        disabled={atCap}
        onClick={onOpenSearch}
        style={{
          width: '100%', maxWidth: 500, margin: '0 auto', display: 'flex',
          height: 62, borderRadius: 14,
          background: atCap ? 'rgba(255,255,255,0.06)' : `linear-gradient(90deg, ${ACCENT}, ${ACCENT2})`,
          border: 'none', color: atCap ? 'rgba(255,255,255,0.35)' : '#000',
          fontFamily: 'var(--font-grotesk, system-ui)', fontSize: 18.2, fontWeight: 800, letterSpacing: 0.4,
          cursor: atCap ? 'default' : 'pointer',
          boxShadow: atCap ? 'none' : `0 12px 32px -8px ${ACCENT}90, 0 0 0 1px rgba(255,255,255,0.15) inset`,
          alignItems: 'center', justifyContent: 'center', gap: 9,
          transition: 'all 160ms',
        }}
      >
        {!atCap && (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        )}
        REQUEST A SONG
      </button>
    </div>
  );
}
