import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../services/auth.service';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let authServiceMock: { login: ReturnType<typeof vi.fn> };
  let notificationMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authServiceMock = {
      login: vi.fn().mockReturnValue(
        of({
          message: 'Login successful',
          user: { id: 1, name: 'Test User', email: 'test@example.com' },
        }),
      ),
    };

    notificationMock = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceMock },
        { provide: NotificationService, useValue: notificationMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should require valid email and password before submitting', () => {
    component.onSubmit();
    expect(component.form.invalid).toBe(true);
    expect(authServiceMock.login).not.toHaveBeenCalled();
  });

  it('should call AuthService.login with selected role and navigate to /tasks on success', () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    component.selectRole('admin');
    component.form.setValue({
      email: 'test@example.com',
      password: 'Password123',
    });

    component.onSubmit();

    expect(authServiceMock.login).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'Password123',
      role: 'admin',
    });
    expect(notificationMock.success).toHaveBeenCalledWith('Login successful');
    expect(navSpy).toHaveBeenCalledWith('/tasks');
  });

  it('should display general error message on 401 invalid credentials or 422 role error', () => {
    authServiceMock.login.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: {
              message: 'You do not have permission to sign in with the selected role.',
              errors: {
                role: ['You do not have permission to sign in with the selected role.'],
              },
            },
          }),
      ),
    );

    component.selectRole('admin');
    component.form.setValue({
      email: 'test@example.com',
      password: 'WrongPassword123',
    });

    component.onSubmit();

    expect(component.generalError()).toBe(
      'You do not have permission to sign in with the selected role.',
    );
  });
});
