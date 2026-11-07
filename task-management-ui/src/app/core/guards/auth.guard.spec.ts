import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../services/auth.service';
import { authGuard, guestGuard } from './auth.guard';

describe('authGuard and guestGuard', () => {
  let authServiceMock: {
    ensureSessionLoaded: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    authServiceMock = {
      ensureSessionLoaded: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: authServiceMock }],
    });
  });

  it('authGuard should allow navigation when user is authenticated', async () => {
    authServiceMock.ensureSessionLoaded.mockReturnValue(of(true));

    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() =>
        authGuard({} as ActivatedRouteSnapshot, { url: '/tasks' } as RouterStateSnapshot),
      ) as Observable<boolean | UrlTree>,
    );

    expect(result).toBe(true);
  });

  it('authGuard should redirect to /login when user is unauthenticated', async () => {
    authServiceMock.ensureSessionLoaded.mockReturnValue(of(false));
    const router = TestBed.inject(Router);

    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() =>
        authGuard({} as ActivatedRouteSnapshot, { url: '/tasks/new' } as RouterStateSnapshot),
      ) as Observable<boolean | UrlTree>,
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/login?returnUrl=%2Ftasks%2Fnew');
  });

  it('guestGuard should redirect authenticated user to /tasks', async () => {
    authServiceMock.ensureSessionLoaded.mockReturnValue(of(true));
    const router = TestBed.inject(Router);

    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() =>
        guestGuard({} as ActivatedRouteSnapshot, { url: '/login' } as RouterStateSnapshot),
      ) as Observable<boolean | UrlTree>,
    );

    expect(router.serializeUrl(result as UrlTree)).toBe('/tasks');
  });
});
