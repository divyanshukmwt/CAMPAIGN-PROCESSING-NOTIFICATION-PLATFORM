import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { TabLockService } from '../core/services/tab-lock.service';
import {
  AuthResponse,
  LoginPayload,
  LogoutResponse,
  RegisterPayload,
  User,
  UserRole,
} from '../models/user';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly tabLock = inject(TabLockService);
  private readonly apiUrl = environment.apiUrl;
  private readonly baseUrl = environment.baseUrl;

  readonly currentUser = signal<User | null>(null);
  readonly initialized = signal<boolean>(false);
  readonly roleVersion = signal<number>(0);

  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly activeRole = computed<UserRole>(() => this.currentUser()?.active_role ?? 'user');
  readonly isAdmin = computed<boolean>(() => this.activeRole() === 'admin');
  readonly hasDualRoles = computed<boolean>(() => {
    const roles = this.currentUser()?.roles ?? [];
    return roles.includes('admin') && roles.includes('user');
  });

  csrfCookie(): Observable<unknown> {
    return this.http.get(`${this.baseUrl}/sanctum/csrf-cookie`);
  }

  login(payload: LoginPayload): Observable<AuthResponse> {
    return this.csrfCookie().pipe(
      switchMap(() =>
        this.http.post<AuthResponse>(`${this.apiUrl}/login`, payload).pipe(
          tap((response) => {
            this.tabLock.setTabToken(response.tab_token);
            this.currentUser.set(response.user);
            this.initialized.set(true);
            this.roleVersion.update((v) => v + 1);
          }),
        ),
      ),
    );
  }

  register(payload: RegisterPayload): Observable<AuthResponse> {
    return this.csrfCookie().pipe(
      switchMap(() =>
        this.http.post<AuthResponse>(`${this.apiUrl}/register`, payload).pipe(
          tap((response) => {
            this.tabLock.setTabToken(response.tab_token);
            this.currentUser.set(response.user);
            this.initialized.set(true);
            this.roleVersion.update((v) => v + 1);
          }),
        ),
      ),
    );
  }

  switchRole(role: UserRole): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/switch-role`, { role }).pipe(
      tap((response) => {
        this.tabLock.setTabToken(response.tab_token);
        this.currentUser.set(response.user);
        this.roleVersion.update((v) => v + 1);
      }),
    );
  }

  getUsers(): Observable<User[]> {
    return this.http.get<User[]>(`${this.apiUrl}/users`);
  }

  logout(): Observable<LogoutResponse> {
    return this.http.post<LogoutResponse>(`${this.apiUrl}/logout`, {}).pipe(
      tap(() => {
        this.clearSession();
      }),
    );
  }

  loadUser(): Observable<User | null> {
    const headers = new HttpHeaders({ 'X-Skip-Error-Notification': 'true' });
    return this.http.get<User>(`${this.apiUrl}/user`, { headers }).pipe(
      tap((user) => {
        this.currentUser.set(user);
        this.initialized.set(true);
      }),
      catchError(() => {
        this.currentUser.set(null);
        this.initialized.set(true);
        return of(null);
      }),
    );
  }

  ensureSessionLoaded(): Observable<boolean> {
    if (this.initialized()) {
      return of(this.isAuthenticated());
    }
    return this.loadUser().pipe(map((user) => user !== null));
  }

  clearSession(): void {
    this.tabLock.clearTabToken();
    this.currentUser.set(null);
    this.initialized.set(true);
  }
}
