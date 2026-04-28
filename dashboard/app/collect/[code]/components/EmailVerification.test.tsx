import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmailVerification from './EmailVerification';

describe('EmailVerification — onSkip prop', () => {
  it('renders "Skip for now" button when onSkip is provided', () => {
    render(
      <EmailVerification isVerified={false} onVerified={vi.fn()} onSkip={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument();
  });

  it('does NOT render "Skip for now" button when onSkip is omitted', () => {
    render(<EmailVerification isVerified={false} onVerified={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /skip for now/i })).toBeNull();
  });

  it('calls onSkip when "Skip for now" is clicked', () => {
    const onSkip = vi.fn();
    render(
      <EmailVerification isVerified={false} onVerified={vi.fn()} onSkip={onSkip} />
    );
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('does NOT render "Skip for now" button when isVerified is true (component starts in verified state)', () => {
    render(
      <EmailVerification isVerified={true} onVerified={vi.fn()} onSkip={vi.fn()} />
    );
    expect(screen.queryByRole('button', { name: /skip for now/i })).toBeNull();
  });
});
