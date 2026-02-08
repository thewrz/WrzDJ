'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function PendingPage() {
  const { isAuthenticated, isLoading, role, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    } else if (!isLoading && role && role !== 'pending') {
      router.push('/events');
    }
  }, [isAuthenticated, isLoading, role, router]);

  if (isLoading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: '500px', marginTop: '100px' }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem' }}>Account Pending</h1>
        <p style={{ color: '#9ca3af', marginBottom: '2rem' }}>
          Your account is awaiting admin approval. You&apos;ll be able to use WrzDJ
          once an administrator approves your registration.
        </p>
        <button
          className="btn"
          style={{ background: '#333' }}
          onClick={logout}
        >
          Logout
        </button>
      </div>
    </div>
  );
}
