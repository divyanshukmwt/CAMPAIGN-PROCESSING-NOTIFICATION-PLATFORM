import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from './notification.service';

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const WARNING_THRESHOLD_MS = 60 * 1000; // Show warning during final 60 seconds

/**
 * Monitors user interaction events and automatically terminates the session
 * if the user remains inactive beyond the allowed security threshold.
 */
@Injectable({
  providedIn: 'root',
})
export class IdleTimeoutService implements OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);

  readonly remainingWarningSeconds = signal<number | null>(null);

  private lastActivityAt = Date.now();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private idleLimitMs = DEFAULT_IDLE_TIMEOUT_MS;

  private readonly activityHandler = (): void => {
    this.recordActivity();
  };

  startMonitoring(idleLimitMs: number = DEFAULT_IDLE_TIMEOUT_MS): void {
    this.idleLimitMs = idleLimitMs;
    this.lastActivityAt = Date.now();

    if (this.started || typeof window === 'undefined') {
      return;
    }
    this.started = true;

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    for (const evt of events) {
      window.addEventListener(evt, this.activityHandler, { passive: true });
    }

    this.checkTimer = setInterval(() => {
      this.evaluateIdleState();
    }, 1000);
  }

  recordActivity(): void {
    this.lastActivityAt = Date.now();
    if (this.remainingWarningSeconds() !== null) {
      this.remainingWarningSeconds.set(null);
    }
  }

  evaluateIdleState(now: number = Date.now()): void {
    if (!this.authService.isAuthenticated()) {
      this.remainingWarningSeconds.set(null);
      this.lastActivityAt = now;
      return;
    }

    const elapsed = now - this.lastActivityAt;
    const remaining = this.idleLimitMs - elapsed;

    if (remaining <= 0) {
      this.remainingWarningSeconds.set(null);
      this.lastActivityAt = now;
      this.authService.logout().subscribe({
        error: () => this.authService.clearSession(),
      });
      this.notification.error('Session terminated due to inactivity.');
      void this.router.navigate(['/login']);
      return;
    }

    if (remaining <= WARNING_THRESHOLD_MS) {
      this.remainingWarningSeconds.set(Math.ceil(remaining / 1000));
    } else if (this.remainingWarningSeconds() !== null) {
      this.remainingWarningSeconds.set(null);
    }
  }

  ngOnDestroy(): void {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    if (typeof window !== 'undefined') {
      const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
      for (const evt of events) {
        window.removeEventListener(evt, this.activityHandler);
      }
    }
    this.started = false;
  }
}
