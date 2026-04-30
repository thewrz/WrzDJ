import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EmailRecoveryButton from '../EmailRecoveryButton'

describe('EmailRecoveryButton', () => {
  it('renders passive variant when reconcileHint is false', () => {
    render(<EmailRecoveryButton reconcileHint={false} onOpen={vi.fn()} />)
    expect(screen.getByText(/already have an account/i)).toBeInTheDocument()
    expect(screen.queryByText(/looks like you might be a returning guest/i)).not.toBeInTheDocument()
  })

  it('renders emphasized banner when reconcileHint is true', () => {
    render(<EmailRecoveryButton reconcileHint={true} onOpen={vi.fn()} />)
    expect(screen.getByText(/looks like you might be a returning guest/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /verify email to recover/i })).toBeInTheDocument()
  })

  it('calls onOpen when passive link is clicked', () => {
    const onOpen = vi.fn()
    render(<EmailRecoveryButton reconcileHint={false} onOpen={onOpen} />)
    fireEvent.click(screen.getByText(/verify email/i))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('calls onOpen when emphasized button is clicked', () => {
    const onOpen = vi.fn()
    render(<EmailRecoveryButton reconcileHint={true} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /verify email to recover/i }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
