'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function BeatportCallbackPage() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code) {
      setError('Missing authorization code');
      return;
    }

    if (window.opener) {
      window.opener.postMessage(
        { type: 'beatport-auth-callback', code, state },
        window.location.origin
      );
      window.close();
    } else {
      setError('Unable to communicate with the main window. Please close this window and try again.');
    }
  }, [searchParams]);

  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0a0a0a', color: '#ededed' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <p style={{ color: '#ff6b6b', marginBottom: 16 }}>{error}</p>
          <button
            onClick={() => window.close()}
            style={{ padding: '8px 24px', background: '#333', color: '#ededed', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Close Window
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0a0a0a', color: '#ededed' }}>
      <p>Completing authentication...</p>
    </div>
  );
}
