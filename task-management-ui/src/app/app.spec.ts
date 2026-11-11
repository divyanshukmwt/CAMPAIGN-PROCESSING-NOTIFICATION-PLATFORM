import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../environments/environment';
import { App } from './app';
import { appConfig } from './app.config';
import { TabLockService } from './core/services/tab-lock.service';
import { AuthService } from './services/auth.service';

describe('App', () => {
  beforeEach(async () => {
    sessionStorage.clear();
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [...appConfig.providers, provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the Material app shell toolbar and navigation links', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand-title')?.textContent).toContain('Task Management System');
    expect(compiled.querySelector('nav[aria-label="Primary navigation"]')).toBeTruthy();
  });

  it('should render duplicate-tab security lockout screen when TabLockService flags a duplicate tab', async () => {
    const tabLock = TestBed.inject(TabLockService);
    tabLock.blockAsDuplicateTab('Duplicate tab detected');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="duplicate-tab-lockout"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="duplicate-tab-message"]')?.textContent).toContain(
      'Duplicate tab detected',
    );
  });

  it('should render role badge and Switch Role button for dual-role users', async () => {
    const authService = TestBed.inject(AuthService);
    authService.currentUser.set({
      id: 1,
      name: 'Dual User',
      email: 'dual@example.com',
      roles: ['admin', 'user'],
      active_role: 'user',
    });

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(
      compiled.querySelector('[data-testid="nav-active-role-badge"]')?.textContent,
    ).toContain('USER');
    expect(
      compiled.querySelector('[data-testid="nav-switch-role-btn"]')?.textContent,
    ).toContain('Switch to Admin');
  });

  it('should provide HttpClient in application config', () => {
    const http = TestBed.inject(HttpClient);
    expect(http).toBeTruthy();
  });

  it('should configure environment API URLs', () => {
    expect(environment.apiUrl).toBe('http://localhost:8000/api');
    expect(environment.baseUrl).toBe('http://localhost:8000');
  });
});
