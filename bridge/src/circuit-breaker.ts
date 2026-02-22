/**
 * Simple circuit breaker for backend API communication.
 *
 * States:
 *   CLOSED  — normal operation, requests flow through
 *   OPEN    — backend assumed down, requests short-circuited for cooldown period
 *   HALF_OPEN — one probe request allowed to test recovery
 *
 * Transitions:
 *   CLOSED → OPEN: after `failureThreshold` consecutive full-retry failures
 *   OPEN → HALF_OPEN: after `cooldownMs` elapses
 *   HALF_OPEN → CLOSED: probe request succeeds
 *   HALF_OPEN → OPEN: probe request fails (resets cooldown)
 */
import { EventEmitter } from "events";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit (default: 3) */
  readonly failureThreshold?: number;
  /** Milliseconds to wait in OPEN state before attempting a probe (default: 60000) */
  readonly cooldownMs?: number;
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * CircuitBreaker tracks consecutive API failures and short-circuits
 * requests when the backend appears unreachable.
 *
 * Events:
 *   'stateChange' - emitted with { from, to } when circuit state changes
 */
export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private probeInFlight = false;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(config?: CircuitBreakerConfig) {
    super();
    this.failureThreshold = config?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs = config?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  /** Current circuit state. */
  getState(): CircuitState {
    return this.state;
  }

  /** Number of consecutive failures recorded. */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /**
   * Check if a request should be allowed through.
   * Returns true if the request can proceed, false if it should be skipped.
   *
   * In HALF_OPEN state, only one probe request is allowed at a time.
   */
  allowRequest(): boolean {
    if (this.state === "CLOSED") {
      return true;
    }

    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.cooldownMs) {
        this.transitionTo("HALF_OPEN");
        // This first request IS the probe — mark in-flight
        this.probeInFlight = true;
        return true;
      }
      return false;
    }

    // HALF_OPEN — only one probe at a time
    if (this.probeInFlight) {
      return false;
    }
    this.probeInFlight = true;
    return true;
  }

  /** Record a successful request. Resets failure count and closes circuit. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.probeInFlight = false;
    if (this.state !== "CLOSED") {
      this.transitionTo("CLOSED");
    }
  }

  /** Record a failed request. Increments failure count and may open circuit. */
  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    this.probeInFlight = false;

    if (this.state === "HALF_OPEN") {
      this.transitionTo("OPEN");
      return;
    }

    if (this.state === "CLOSED" && this.consecutiveFailures >= this.failureThreshold) {
      this.transitionTo("OPEN");
    }
  }

  /** Reset the circuit breaker to its initial state. */
  reset(): void {
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
    this.probeInFlight = false;
    if (this.state !== "CLOSED") {
      this.transitionTo("CLOSED");
    }
  }

  private transitionTo(newState: CircuitState): void {
    const from = this.state;
    this.state = newState;
    this.emit("stateChange", { from, to: newState });
  }
}
