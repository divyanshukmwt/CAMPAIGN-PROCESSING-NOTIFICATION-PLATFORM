import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NotificationService } from '../../core/services/notification.service';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TaskPayload,
  TaskPriority,
  TaskStatus,
} from '../../models/task';
import { User } from '../../models/user';
import { AuthService } from '../../services/auth.service';
import { TaskService } from '../../services/task.service';

@Component({
  selector: 'app-task-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './task-form.component.html',
  styleUrl: './task-form.component.scss',
})
export class TaskFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly taskService = inject(TaskService);
  protected readonly authService = inject(AuthService);
  private readonly notification = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly statuses = TASK_STATUSES;
  readonly priorities = TASK_PRIORITIES;

  readonly taskId = signal<number | null>(null);
  readonly isEditMode = computed(() => this.taskId() !== null);
  readonly loadingTask = signal<boolean>(false);
  readonly submitting = signal<boolean>(false);
  readonly loadError = signal<string | null>(null);
  readonly users = signal<User[]>([]);
  readonly selectedAssigneeId = signal<number | null>(null);

  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(255)]],
    description: [''],
    status: ['Pending' as TaskStatus, [Validators.required]],
    priority: ['Medium' as TaskPriority, [Validators.required]],
    due_date: [''],
  });

  ngOnInit(): void {
    if (this.authService.isAdmin()) {
      this.authService
        .getUsers()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (list) => this.users.set(list),
          error: () => this.users.set([]),
        });
    }

    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      const parsedId = Number(idParam);
      if (Number.isFinite(parsedId) && parsedId > 0) {
        this.taskId.set(parsedId);
        this.fetchTask(parsedId);
      }
    }
  }

  selectAssignee(userId: number | null): void {
    this.selectedAssigneeId.set(userId);
  }

  fetchTask(id: number): void {
    this.loadingTask.set(true);
    this.loadError.set(null);

    this.taskService
      .getTask(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (task) => {
          this.form.patchValue({
            title: task.title,
            description: task.description ?? '',
            status: task.status,
            priority: task.priority,
            due_date: task.due_date ? task.due_date.slice(0, 10) : '',
          });
          this.selectedAssigneeId.set(
            task.assigned_to_user_id ?? task.assigned_to?.id ?? null,
          );
          this.loadingTask.set(false);
        },
        error: (err) => {
          this.loadError.set(err?.error?.message || 'Task not found');
          this.loadingTask.set(false);
        },
      });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    const raw = this.form.getRawValue();
    const payload: TaskPayload = {
      title: raw.title.trim(),
      description: raw.description.trim() ? raw.description.trim() : null,
      status: raw.status,
      priority: raw.priority,
      due_date: raw.due_date ? raw.due_date : null,
    };

    if (this.authService.isAdmin() && this.selectedAssigneeId() !== null) {
      payload.assigned_to_user_id = this.selectedAssigneeId();
    }

    const id = this.taskId();
    const request$ =
      id !== null
        ? this.taskService.updateTask(id, payload)
        : this.taskService.createTask(payload);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.notification.success(res.message);
        void this.router.navigate(['/tasks']);
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        this.applyServerValidationErrors(err);
      },
    });
  }

  private applyServerValidationErrors(error: HttpErrorResponse): void {
    if (error.status !== 422 || !error.error?.errors) {
      return;
    }

    const fieldErrors = error.error.errors as Record<string, string[]>;
    for (const [field, messages] of Object.entries(fieldErrors)) {
      const control = this.form.get(field);
      if (control && Array.isArray(messages) && messages.length > 0) {
        control.setErrors({ serverError: messages[0] });
        control.markAsTouched();
      }
    }
  }
}
