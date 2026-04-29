import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmailRecoveryModal from '../EmailRecoveryModal';

vi.mock('../EmailVerification', () => ({
  default: ({ onVerified }: { onVerified: () => void }) => (
    <div data-testid="email-verification-mock">
      <button onClick={onVerified}>simulate-verified</button>
    </div>
  ),
}));

describe('EmailRecoveryModal', () => {
  it('does not render when open is false', () => {
    render(<EmailRecoveryModal open={false} onClose={vi.fn()} onRecovered={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog when open is true', () => {
    render(<EmailRecoveryModal open={true} onClose={vi.fn()} onRecovered={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('email-verification-mock')).toBeInTheDocument();
  });

  it('calls onClose when ESC is pressed', () => {
    const onClose = vi.fn();
    render(<EmailRecoveryModal open={true} onClose={onClose} onRecovered={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onRecovered after EmailVerification onVerified fires', () => {
    const onClose = vi.fn();
    const onRecovered = vi.fn();
    render(<EmailRecoveryModal open={true} onClose={onClose} onRecovered={onRecovered} />);

    fireEvent.click(screen.getByText('simulate-verified'));

    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<EmailRecoveryModal open={true} onClose={onClose} onRecovered={vi.fn()} />);
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
