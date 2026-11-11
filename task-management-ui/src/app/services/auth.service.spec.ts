import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { User } from '../models/user';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  const sampleUser: User = {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
    roles: ['admin', 'user'],
    active_role: 'user',
  };

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [AuthService, provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('should request CSRF cookie then POST /api/login and store currentUser and tab_token', () => {
    let loggedInUser: User | undefined;

    service
      .login({ email: 'test@example.com', password: 'Password123', role: 'user' })
      .subscribe((res) => (loggedInUser = res.user));

    const csrfReq = httpMock.expectOne(`${environment.baseUrl}/sanctum/csrf-cookie`);
    expect(csrfReq.request.method).toBe('GET');
    csrfReq.flush(null);

    const loginReq = httpMock.expectOne(`${environment.apiUrl}/login`);
    expect(loginReq.request.method).toBe('POST');
    expect(loginReq.request.body).toEqual({
      email: 'test@example.com',
      password: 'Password123',
      role: 'user',
    });
    loginReq.flush({
      message: 'Login successful',
      user: sampleUser,
      tab_token: 'tab-token-xyz',
    });

    expect(loggedInUser).toEqual(sampleUser);
    expect(service.currentUser()).toEqual(sampleUser);
    expect(service.isAuthenticated()).toBe(true);
    expect(service.hasDualRoles()).toBe(true);
    expect(service.isAdmin()).toBe(false);
    expect(sessionStorage.getItem('tms_tab_token')).toBe('tab-token-xyz');
  });

  it('should switch active role via POST /api/auth/switch-role', () => {
    service.currentUser.set(sampleUser);

    service.switchRole('admin').subscribe();

    const switchReq = httpMock.expectOne(`${environment.apiUrl}/auth/switch-role`);
    expect(switchReq.request.method).toBe('POST');
    expect(switchReq.request.body).toEqual({ role: 'admin' });
    switchReq.flush({
      message: 'Role switched successfully',
      user: { ...sampleUser, active_role: 'admin' },
      tab_token: 'rotated-tab-token',
    });

    expect(service.activeRole()).toBe('admin');
    expect(service.isAdmin()).toBe(true);
    expect(sessionStorage.getItem('tms_tab_token')).toBe('rotated-tab-token');
  });

  it('should request CSRF cookie then POST /api/register and store currentUser', () => {
    service
      .register({
        name: 'Test User',
        email: 'test@example.com',
        password: 'Password123',
        password_confirmation: 'Password123',
      })
      .subscribe();

    const csrfReq = httpMock.expectOne(`${environment.baseUrl}/sanctum/csrf-cookie`);
    csrfReq.flush(null);

    const registerReq = httpMock.expectOne(`${environment.apiUrl}/register`);
    expect(registerReq.request.method).toBe('POST');
    registerReq.flush({
      message: 'User registered successfully',
      user: sampleUser,
    });

    expect(service.currentUser()).toEqual(sampleUser);
    expect(service.isAuthenticated()).toBe(true);
  });

  it('should clear currentUser on POST /api/logout', () => {
    service.currentUser.set(sampleUser);

    service.logout().subscribe();

    const logoutReq = httpMock.expectOne(`${environment.apiUrl}/logout`);
    expect(logoutReq.request.method).toBe('POST');
    logoutReq.flush({ message: 'Logged out successfully' });

    expect(service.currentUser()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('should load current user via GET /api/user and handle 401 gracefully', () => {
    let result: User | null | undefined;
    service.loadUser().subscribe((user) => (result = user));

    const userReq = httpMock.expectOne(`${environment.apiUrl}/user`);
    expect(userReq.request.method).toBe('GET');
    userReq.flush({ message: 'Unauthenticated.' }, { status: 401, statusText: 'Unauthorized' });

    expect(result).toBeNull();
    expect(service.initialized()).toBe(true);
    expect(service.isAuthenticated()).toBe(false);
  });
});
