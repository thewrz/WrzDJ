import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'WrzDJ Dashboard',
  description: 'DJ song request management',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
