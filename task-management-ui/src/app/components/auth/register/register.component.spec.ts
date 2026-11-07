import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../services/auth.service';
import { RegisterComponent } from './register.component';

describe('RegisterComponent', () => {
  let component: RegisterComponent;
  let fixture: ComponentFixture<RegisterComponent>;
  let authServiceMock: { register: ReturnType<typeof vi.fn> };
  let notificationMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authServiceMock = {
      register: vi.fn().mockReturnValue(
        of({
          message: 'User registered successfully',
          user: { id: 1, name: 'Jane Doe', email: 'jane@example.com' },
        }),
      ),
    };

    notificationMock = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceMock },
        { provide: NotificationService, useValue: notificationMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should flag passwordMismatch when password and confirmation differ', () => {
    component.form.setValue({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'Password123',
      password_confirmation: 'Different123',
    });

    expect(component.form.hasError('passwordMismatch')).toBe(true);
    component.onSubmit();
    expect(authServiceMock.register).not.toHaveBeenCalled();
  });

  it('should submit registration and navigate to /tasks on success', () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.form.setValue({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'Password123',
      password_confirmation: 'Password123',
    });

    component.onSubmit();

    expect(authServiceMock.register).toHaveBeenCalledWith({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'Password123',
      password_confirmation: 'Password123',
    });
    expect(notificationMock.success).toHaveBeenCalledWith('User registered successfully');
    expect(navSpy).toHaveBeenCalledWith(['/tasks']);
  });
});
