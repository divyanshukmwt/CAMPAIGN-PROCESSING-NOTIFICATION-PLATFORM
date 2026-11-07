import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { NotificationService } from '../../core/services/notification.service';
import { Task } from '../../models/task';
import { TaskService } from '../../services/task.service';
import { TaskListComponent } from './task-list.component';

describe('TaskListComponent', () => {
  let component: TaskListComponent;
  let fixture: ComponentFixture<TaskListComponent>;
  let taskServiceMock: {
    getTasks: ReturnType<typeof vi.fn>;
    deleteTask: ReturnType<typeof vi.fn>;
  };
  let notificationMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };

  const sampleTasks: Task[] = [
    {
      id: 1,
      title: 'Complete Laravel API',
      description: 'Build CRUD API for tasks',
      status: 'In Progress',
      priority: 'High',
      due_date: '2026-03-20',
    },
    {
      id: 2,
      title: 'Prepare Angular UI',
      description: 'Build responsive Material components',
      status: 'Pending',
      priority: 'Medium',
      due_date: null,
    },
  ];

  beforeEach(async () => {
    taskServiceMock = {
      getTasks: vi.fn().mockReturnValue(of(sampleTasks)),
      deleteTask: vi.fn().mockReturnValue(of({ message: 'Task deleted successfully' })),
    };

    notificationMock = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [TaskListComponent],
      providers: [
        provideRouter([]),
        { provide: TaskService, useValue: taskServiceMock },
        { provide: NotificationService, useValue: notificationMock },
      ],
    }).compileComponents();
  });

  it('should render loading spinner while tasks are being fetched', () => {
    const pending$ = new Subject<Task[]>();
    taskServiceMock.getTasks.mockReturnValue(pending$.asObservable());

    fixture = TestBed.createComponent(TaskListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="tasks-loading"]')).toBeTruthy();

    pending$.next(sampleTasks);
    pending$.complete();
    fixture.detectChanges();
  });

  it('should render the task table when tasks are returned', () => {
    fixture = TestBed.createComponent(TaskListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const rows = compiled.querySelectorAll('[data-testid="task-row"]');
    expect(rows.length).toBe(2);
    expect(compiled.textContent).toContain('Complete Laravel API');
    expect(compiled.textContent).toContain('Prepare Angular UI');
  });

  it('should render empty state when no tasks exist', () => {
    taskServiceMock.getTasks.mockReturnValue(of([]));

    fixture = TestBed.createComponent(TaskListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="tasks-empty"]')).toBeTruthy();
    expect(compiled.textContent).toContain('No tasks found');
  });

  it('should render error state when task loading fails and allow retry', () => {
    taskServiceMock.getTasks.mockReturnValueOnce(
      throwError(() => ({ error: { message: 'Database unavailable' } })),
    );

    fixture = TestBed.createComponent(TaskListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="tasks-error"]')).toBeTruthy();
    expect(compiled.textContent).toContain('Database unavailable');

    taskServiceMock.getTasks.mockReturnValueOnce(of(sampleTasks));
    const retryBtn = compiled.querySelector('[data-testid="retry-tasks-btn"]') as HTMLButtonElement;
    retryBtn.click();
    fixture.detectChanges();

    expect(compiled.querySelectorAll('[data-testid="task-row"]').length).toBe(2);
  });

  it('should filter tasks by title when search input changes after debounce', async () => {
    vi.useFakeTimers();
    try {
      fixture = TestBed.createComponent(TaskListComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();

      expect(taskServiceMock.getTasks).toHaveBeenCalledTimes(1);

      component.searchControl.setValue('Laravel');
      vi.advanceTimersByTime(350);

      expect(taskServiceMock.getTasks).toHaveBeenCalledWith('Laravel');
    } finally {
      vi.useRealTimers();
    }
  });
});
