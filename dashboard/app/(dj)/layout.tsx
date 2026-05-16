'use client';

import { type ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function DJLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div style={{
        position: 'fixed',
        top: '1rem',
        right: '4.5rem',
        zIndex: 1100,
      }}>
        <ThemeToggle />
      </div>
      {children}
    </>
  );
}
