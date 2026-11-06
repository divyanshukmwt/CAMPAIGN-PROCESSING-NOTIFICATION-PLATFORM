import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { NotificationService } from '../services/notification.service';
import { errorInterceptor } from './error.interceptor';

describe('errorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let notificationMock: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    notificationMock = {
      error: vi.fn(),
      success: vi.fn(),
      info: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: NotificationService, useValue: notificationMock },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should notify and rethrow on 404 Not Found', () => {
    let capturedError: HttpErrorResponse | undefined;

    http.get('http://localhost:8000/api/tasks/999').subscribe({
      error: (err) => (capturedError = err),
    });

    const req = httpMock.expectOne('http://localhost:8000/api/tasks/999');
    req.flush({ message: 'Task not found' }, { status: 404, statusText: 'Not Found' });

    expect(notificationMock.error).toHaveBeenCalledWith('Task not found');
    expect(capturedError?.status).toBe(404);
  });

  it('should notify and preserve field errors on 422 Unprocessable Content', () => {
    let capturedError: HttpErrorResponse | undefined;

    http.post('http://localhost:8000/api/tasks', {}).subscribe({
      error: (err) => (capturedError = err),
    });

    const req = httpMock.expectOne('http://localhost:8000/api/tasks');
    req.flush(
      {
        message: 'The title field is required.',
        errors: { title: ['The title field is required.'] },
      },
      { status: 422, statusText: 'Unprocessable Content' },
    );

    expect(notificationMock.error).toHaveBeenCalledWith('The title field is required.');
    expect(capturedError?.error.errors.title).toEqual(['The title field is required.']);
  });

  it('should suppress notification for silent /api/user session probe on 401', () => {
    http.get('http://localhost:8000/api/user').subscribe({
      error: () => undefined,
    });

    const req = httpMock.expectOne('http://localhost:8000/api/user');
    req.flush({ message: 'Unauthenticated.' }, { status: 401, statusText: 'Unauthorized' });

    expect(notificationMock.error).not.toHaveBeenCalled();
  });
});
