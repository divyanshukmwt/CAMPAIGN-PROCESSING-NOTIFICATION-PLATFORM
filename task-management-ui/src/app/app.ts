import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IdleTimeoutService } from './core/services/idle-timeout.service';
import { NotificationService } from './core/services/notification.service';
import { TabLockService } from './core/services/tab-lock.service';
import { UserRole } from './models/user';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly authService = inject(AuthService);
  protected readonly tabLock = inject(TabLockService);
  protected readonly idleTimeout = inject(IdleTimeoutService);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);

  protected readonly title = signal('Task Management System');
  protected readonly switchingRole = signal<boolean>(false);

  ngOnInit(): void {
    this.tabLock.initTabGuard();
    this.idleTimeout.startMonitoring();
  }

  switchRole(): void {
    if (this.switchingRole()) {
      return;
    }
    const targetRole: UserRole = this.authService.isAdmin() ? 'user' : 'admin';
    this.switchingRole.set(true);

    this.authService.switchRole(targetRole).subscribe({
      next: () => {
        this.switchingRole.set(false);
        this.notification.success(
          `Switched active role to ${targetRole === 'admin' ? 'Admin' : 'User'}`,
        );
      },
      error: () => {
        this.switchingRole.set(false);
      },
    });
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: (res) => {
        this.notification.success(res.message || 'Logged out successfully');
        void this.router.navigate(['/login']);
      },
    });
  }
}
