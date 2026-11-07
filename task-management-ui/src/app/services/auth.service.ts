import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AuthResponse,
  LoginPayload,
  LogoutResponse,
  RegisterPayload,
  User,
} from '../models/user';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;
  private readonly baseUrl = environment.baseUrl;

  readonly currentUser = signal<User | null>(null);
  readonly initialized = signal<boolean>(false);
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  csrfCookie(): Observable<unknown> {
    return this.http.get(`${this.baseUrl}/sanctum/csrf-cookie`);
  }

  login(payload: LoginPayload): Observable<AuthResponse> {
    return this.csrfCookie().pipe(
      switchMap(() =>
        this.http.post<AuthResponse>(`${this.apiUrl}/login`, payload).pipe(
          tap((response) => {
            this.currentUser.set(response.user);
            this.initialized.set(true);
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
            this.currentUser.set(response.user);
            this.initialized.set(true);
          }),
        ),
      ),
    );
  }

  logout(): Observable<LogoutResponse> {
    return this.http.post<LogoutResponse>(`${this.apiUrl}/logout`, {}).pipe(
      tap(() => {
        this.currentUser.set(null);
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
    this.currentUser.set(null);
    this.initialized.set(true);
  }
}
