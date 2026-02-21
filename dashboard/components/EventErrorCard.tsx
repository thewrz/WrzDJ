import Link from 'next/link';

interface EventErrorCardProps {
  error: { message: string; status: number } | null;
  fallbackMessage?: string;
  backLink?: { href: string; label: string };
}

export function EventErrorCard({
  error,
  fallbackMessage = 'Event not found.',
  backLink,
}: EventErrorCardProps) {
  const is410 = error?.status === 410;
  const is404 = error?.status === 404;

  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <h2 style={{ marginBottom: '1rem' }}>
        {is410 ? 'Event Expired' : is404 ? 'Event Not Found' : 'Error'}
      </h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
        {is410
          ? 'This event has expired and is no longer accepting requests.'
          : is404
            ? 'This event does not exist.'
            : error?.message || fallbackMessage}
      </p>
      {backLink && (
        <Link href={backLink.href} className="btn btn-primary" style={{ marginTop: '1rem' }}>
          {backLink.label}
        </Link>
      )}
    </div>
  );
}
