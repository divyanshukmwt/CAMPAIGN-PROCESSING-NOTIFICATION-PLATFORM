import { Injectable, OnDestroy, signal } from '@angular/core';

const TAB_ID_STORAGE_KEY = 'tms_tab_id';
const TAB_TOKEN_STORAGE_KEY = 'tms_tab_token';
const ACTIVE_SESSION_FLAG_KEY = 'tms_session_active';
const ACTIVE_TAB_LOCK_KEY = 'tms_active_tab_lock';
const BROADCAST_CHANNEL_NAME = 'tms_single_tab_guard';
const HEARTBEAT_INTERVAL_MS = 2000;
const LOCK_STALE_THRESHOLD_MS = 5500;

interface TabLockRecord {
  tabId: string;
  timestamp: number;
}

interface TabGuardMessage {
  type: 'TAB_HELLO' | 'TAB_ALREADY_ACTIVE' | 'TAB_CLOSED';
  tabId: string;
  targetTabId?: string;
}

/**
 * Enforces single-tab execution and manages the per-tab cryptographic `X-Tab-Token`.
 *
 * - `sessionStorage` isolates `tms_tab_id` and `tms_tab_token` to a single browser tab.
 * - `BroadcastChannel` + `localStorage` heartbeat immediately detect if the app is
 *   opened in a duplicate tab and block the duplicate tab from executing.
 */
@Injectable({
  providedIn: 'root',
})
export class TabLockService implements OnDestroy {
  readonly tabId: string = this.resolveOrCreateTabId();
  readonly isDuplicateTab = signal<boolean>(false);
  readonly lockReason = signal<string | null>(null);

  private channel: BroadcastChannel | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  private readonly storageListener = (event: StorageEvent): void => {
    if (event.key === ACTIVE_TAB_LOCK_KEY && event.newValue) {
      try {
        const record = JSON.parse(event.newValue) as TabLockRecord;
        if (record.tabId && record.tabId !== this.tabId && !this.isDuplicateTab()) {
          // If we are not the primary owner, yield or defend primary lock
          this.broadcast({
            type: 'TAB_ALREADY_ACTIVE',
            tabId: this.tabId,
            targetTabId: record.tabId,
          });
        }
      } catch {
        // Ignore malformed storage payload
      }
    }
  };

  private readonly unloadListener = (): void => {
    this.releasePrimaryLockIfOwned();
  };

  initTabGuard(): void {
    if (this.initialized || typeof window === 'undefined') {
      return;
    }
    this.initialized = true;

    const existingLock = this.readLockRecord();
    const now = Date.now();

    if (
      existingLock &&
      existingLock.tabId !== this.tabId &&
      now - existingLock.timestamp < LOCK_STALE_THRESHOLD_MS
    ) {
      this.blockAsDuplicateTab(
        'This application is already open in another browser tab. Duplicate tabs are blocked for your security.',
      );
    } else {
      this.writeLockRecord();
      this.startHeartbeat();
    }

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<TabGuardMessage>) => {
        const msg = event.data;
        if (!msg || msg.tabId === this.tabId) {
          return;
        }

        if (msg.type === 'TAB_HELLO' && !this.isDuplicateTab()) {
          this.writeLockRecord();
          this.broadcast({
            type: 'TAB_ALREADY_ACTIVE',
            tabId: this.tabId,
            targetTabId: msg.tabId,
          });
        } else if (
          msg.type === 'TAB_ALREADY_ACTIVE' &&
          (!msg.targetTabId || msg.targetTabId === this.tabId)
        ) {
          this.blockAsDuplicateTab(
            'This application is already open in another browser tab. Duplicate tabs are blocked for your security.',
          );
        }
      };

      this.broadcast({ type: 'TAB_HELLO', tabId: this.tabId });
    }

    window.addEventListener('storage', this.storageListener);
    window.addEventListener('beforeunload', this.unloadListener);
  }

  getTabToken(): string | null {
    try {
      return sessionStorage.getItem(TAB_TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  setTabToken(token: string | null | undefined): void {
    try {
      if (token) {
        sessionStorage.setItem(TAB_TOKEN_STORAGE_KEY, token);
        localStorage.setItem(ACTIVE_SESSION_FLAG_KEY, '1');
      }
    } catch {
      // Ignore storage errors
    }
  }

  clearTabToken(): void {
    try {
      sessionStorage.removeItem(TAB_TOKEN_STORAGE_KEY);
      localStorage.removeItem(ACTIVE_SESSION_FLAG_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Returns true if another tab established an authenticated session in this browser
   * while the current tab does not possess the per-tab `tms_tab_token`.
   */
  hasActiveSessionWithoutTabToken(): boolean {
    try {
      return (
        localStorage.getItem(ACTIVE_SESSION_FLAG_KEY) === '1' &&
        !sessionStorage.getItem(TAB_TOKEN_STORAGE_KEY)
      );
    } catch {
      return false;
    }
  }

  markConflictFromServer(message?: string): void {
    this.blockAsDuplicateTab(
      message ||
        'Active session is locked to another browser tab. Concurrent tab access is not permitted.',
    );
  }

  blockAsDuplicateTab(reason: string): void {
    this.isDuplicateTab.set(true);
    this.lockReason.set(reason);
    this.stopHeartbeat();
  }

  ngOnDestroy(): void {
    this.stopHeartbeat();
    this.releasePrimaryLockIfOwned();
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.storageListener);
      window.removeEventListener('beforeunload', this.unloadListener);
    }
  }

  private resolveOrCreateTabId(): string {
    try {
      const existing = sessionStorage.getItem(TAB_ID_STORAGE_KEY);
      if (existing) {
        return existing;
      }
      const created = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(TAB_ID_STORAGE_KEY, created);
      return created;
    } catch {
      return `tab-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  private readLockRecord(): TabLockRecord | null {
    try {
      const raw = localStorage.getItem(ACTIVE_TAB_LOCK_KEY);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as TabLockRecord;
    } catch {
      return null;
    }
  }

  private writeLockRecord(): void {
    if (this.isDuplicateTab()) {
      return;
    }
    try {
      const record: TabLockRecord = {
        tabId: this.tabId,
        timestamp: Date.now(),
      };
      localStorage.setItem(ACTIVE_TAB_LOCK_KEY, JSON.stringify(record));
    } catch {
      // Ignore storage errors
    }
  }

  private releasePrimaryLockIfOwned(): void {
    try {
      const current = this.readLockRecord();
      if (current && current.tabId === this.tabId) {
        localStorage.removeItem(ACTIVE_TAB_LOCK_KEY);
        this.broadcast({ type: 'TAB_CLOSED', tabId: this.tabId });
      }
    } catch {
      // Ignore storage errors
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.writeLockRecord();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private broadcast(message: TabGuardMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // Ignore closed channel errors
    }
  }
}
