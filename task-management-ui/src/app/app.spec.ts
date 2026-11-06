import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../environments/environment';
import { App } from './app';
import { appConfig } from './app.config';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [...appConfig.providers, provideRouter([])],
    }).compileComponents();
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

  it('should provide HttpClient in application config', () => {
    const http = TestBed.inject(HttpClient);
    expect(http).toBeTruthy();
  });

  it('should configure environment API URLs', () => {
    expect(environment.apiUrl).toBe('http://localhost:8000/api');
    expect(environment.baseUrl).toBe('http://localhost:8000');
  });
});
