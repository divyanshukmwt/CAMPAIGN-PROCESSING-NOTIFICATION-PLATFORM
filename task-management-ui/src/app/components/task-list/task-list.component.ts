import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { NotificationService } from '../../core/services/notification.service';
import { Task, TaskPriority, TaskStatus } from '../../models/task';
import { User } from '../../models/user';
import { AuthService } from '../../services/auth.service';
import { TaskService } from '../../services/task.service';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-task-list',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './task-list.component.html',
  styleUrl: './task-list.component.scss',
})
export class TaskListComponent implements OnInit {
  private readonly taskService = inject(TaskService);
  protected readonly authService = inject(AuthService);
  private readonly notification = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  readonly tasks = signal<Task[]>([]);
  readonly users = signal<User[]>([]);
  readonly selectedUserId = signal<number | null>(null);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);
  readonly searchControl = new FormControl<string>('', { nonNullable: true });

  readonly displayedColumns: readonly string[] = [
    'title',
    'status',
    'priority',
    'due_date',
    'actions',
  ];

  private viewInitialized = false;
  private lastRoleVersion = this.authService.roleVersion();

  constructor() {
    effect(() => {
      const version = this.authService.roleVersion();
      if (this.viewInitialized && version !== this.lastRoleVersion) {
        this.lastRoleVersion = version;
        this.selectedUserId.set(null);
        this.loadAdminUsersIfNeeded();
        this.loadTasks();
      }
    });
  }

  ngOnInit(): void {
    this.viewInitialized = true;
    this.lastRoleVersion = this.authService.roleVersion();
    this.loadAdminUsersIfNeeded();
    this.loadTasks();

    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((term) => {
        this.loadTasks(term);
      });
  }

  loadAdminUsersIfNeeded(): void {
    if (!this.authService.isAdmin()) {
      this.users.set([]);
      return;
    }

    this.authService
      .getUsers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.users.set(list),
        error: () => this.users.set([]),
      });
  }

  onUserFilterChange(userId: number | null): void {
    this.selectedUserId.set(userId);
    this.loadTasks();
  }

  loadTasks(search = this.searchControl.value): void {
    this.loading.set(true);
    this.error.set(null);

    const userId = this.authService.isAdmin() ? this.selectedUserId() : null;
    const request$ =
      userId !== null
        ? this.taskService.getTasks(search, userId)
        : this.taskService.getTasks(search);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (tasks) => {
        this.tasks.set(tasks);
        this.loading.set(false);
      },
      error: (err) => {
        const message =
          err?.error?.message || 'Unable to load tasks. Please try again.';
        this.error.set(message);
        this.loading.set(false);
      },
    });
  }

  clearSearch(): void {
    if (this.searchControl.value) {
      this.searchControl.setValue('');
    } else {
      this.loadTasks('');
    }
  }

  deleteTask(task: Task): void {
    const dialogData: ConfirmDialogData = {
      title: 'Delete Task',
      message: `Are you sure you want to delete "${task.title}"? This action cannot be undone.`,
      confirmLabel: 'Delete Task',
      cancelLabel: 'Cancel',
    };

    this.dialog
      .open(ConfirmDialogComponent, {
        width: '420px',
        data: dialogData,
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.taskService
            .deleteTask(task.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (response) => {
                this.notification.success(response.message || 'Task deleted successfully');
                this.tasks.update((current) => current.filter((item) => item.id !== task.id));
              },
            });
        }
      });
  }

  statusClass(status: TaskStatus): string {
    switch (status) {
      case 'Completed':
        return 'badge-status-completed';
      case 'In Progress':
        return 'badge-status-in-progress';
      default:
        return 'badge-status-pending';
    }
  }

  priorityClass(priority: TaskPriority): string {
    switch (priority) {
      case 'High':
        return 'badge-priority-high';
      case 'Medium':
        return 'badge-priority-medium';
      default:
        return 'badge-priority-low';
    }
  }
}
