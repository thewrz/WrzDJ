import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FeatureOptInPanel from './FeatureOptInPanel';

describe('FeatureOptInPanel', () => {
  it('does not render when guest already has email AND a nickname', () => {
    render(
      <FeatureOptInPanel
        hasEmail={true}
        initialNickname="Alex"
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByText(/make it yours/i)).not.toBeInTheDocument();
  });

  it('shows feature copy and inputs when nothing set yet', () => {
    render(
      <FeatureOptInPanel hasEmail={false} initialNickname={null} onSave={vi.fn()} />,
    );
    expect(screen.getByText(/nickname appears/i)).toBeInTheDocument();
    expect(screen.getByText(/notify me when my song plays/i)).toBeInTheDocument();
    expect(screen.getByText(/cross-device/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^nickname$/i)).toBeInTheDocument();
  });

  it('rejects invalid email on client', async () => {
    const onSave = vi.fn();
    render(
      <FeatureOptInPanel hasEmail={false} initialNickname={null} onSave={onSave} />,
    );
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'bogus' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('requires at least one of nickname or email', async () => {
    const onSave = vi.fn();
    render(
      <FeatureOptInPanel hasEmail={false} initialNickname={null} onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(screen.getByText(/enter a nickname or email/i)).toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onSave with just nickname when only nickname entered', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <FeatureOptInPanel hasEmail={false} initialNickname={null} onSave={onSave} />,
    );
    fireEvent.change(screen.getByLabelText(/^nickname$/i), {
      target: { value: 'DancingQueen' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ nickname: 'DancingQueen' });
    });
  });

  it('calls onSave with both fields when both filled', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <FeatureOptInPanel hasEmail={false} initialNickname={null} onSave={onSave} />,
    );
    fireEvent.change(screen.getByLabelText(/^nickname$/i), {
      target: { value: 'Alex' },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'alex@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        nickname: 'Alex',
        email: 'alex@example.com',
      });
    });
  });
});
