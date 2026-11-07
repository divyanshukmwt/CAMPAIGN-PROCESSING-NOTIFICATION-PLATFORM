import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NotificationService } from '../../core/services/notification.service';
import { Task, TaskPriority, TaskStatus } from '../../models/task';
import { TaskService } from '../../services/task.service';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-task-detail',
  imports: [
    DatePipe,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './task-detail.component.html',
  styleUrl: './task-detail.component.scss',
})
export class TaskDetailComponent implements OnInit {
  private readonly taskService = inject(TaskService);
  private readonly notification = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly task = signal<Task | null>(null);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      this.error.set('Invalid task identifier.');
      this.loading.set(false);
      return;
    }
    this.loadTask(id);
  }

  loadTask(id: number): void {
    this.loading.set(true);
    this.error.set(null);

    this.taskService
      .getTask(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (task) => {
          this.task.set(task);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err?.error?.message || 'Task not found');
          this.loading.set(false);
        },
      });
  }

  confirmDelete(): void {
    const currentTask = this.task();
    if (!currentTask) {
      return;
    }

    const dialogData: ConfirmDialogData = {
      title: 'Delete Task',
      message: `Are you sure you want to delete "${currentTask.title}"? This action cannot be undone.`,
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
            .deleteTask(currentTask.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (res) => {
                this.notification.success(res.message || 'Task deleted successfully');
                void this.router.navigate(['/tasks']);
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
