import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NotificationService } from '../../../core/services/notification.service';
import { UserRole } from '../../../models/user';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly submitting = signal<boolean>(false);
  readonly generalError = signal<string | null>(null);
  readonly selectedRole = signal<UserRole>('user');

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  selectRole(role: UserRole): void {
    this.selectedRole.set(role);
    this.generalError.set(null);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.generalError.set(null);

    const payload = this.form.getRawValue();
    this.authService
      .login({
        email: payload.email.trim(),
        password: payload.password,
        role: this.selectedRole(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.submitting.set(false);
          this.notification.success(response.message || 'Login successful');
          const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/tasks';
          void this.router.navigateByUrl(returnUrl);
        },
        error: (err: HttpErrorResponse) => {
          this.submitting.set(false);
          if (err.status === 422 && err.error?.errors) {
            const errors = err.error.errors as Record<string, string[]>;
            if (errors['role']?.length) {
              this.generalError.set(errors['role'][0]);
            }
            for (const [field, messages] of Object.entries(errors)) {
              const control = this.form.get(field);
              if (control && messages.length > 0) {
                control.setErrors({ serverError: messages[0] });
                control.markAsTouched();
              }
            }
          } else {
            this.generalError.set(err.error?.message || 'Invalid credentials');
          }
        },
      });
  }
}
