import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { NotificationService } from '../../core/services/notification.service';
import { Task } from '../../models/task';
import { TaskService } from '../../services/task.service';
import { TaskDetailComponent } from './task-detail.component';

describe('TaskDetailComponent', () => {
  let component: TaskDetailComponent;
  let fixture: ComponentFixture<TaskDetailComponent>;
  let taskServiceMock: {
    getTask: ReturnType<typeof vi.fn>;
    deleteTask: ReturnType<typeof vi.fn>;
  };
  let notificationMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };
  let dialogOpenSpy: ReturnType<typeof vi.fn>;

  const sampleTask: Task = {
    id: 7,
    title: 'Complete Laravel API',
    description: 'Build CRUD API for tasks',
    status: 'In Progress',
    priority: 'High',
    due_date: '2026-03-20',
    created_at: '2026-03-14T10:00:00.000000Z',
    updated_at: '2026-03-14T10:00:00.000000Z',
  };

  beforeEach(async () => {
    taskServiceMock = {
      getTask: vi.fn().mockReturnValue(of(sampleTask)),
      deleteTask: vi.fn().mockReturnValue(of({ message: 'Task deleted successfully' })),
    };

    notificationMock = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    dialogOpenSpy = vi.fn().mockReturnValue({
      afterClosed: () => of(true),
    });

    await TestBed.configureTestingModule({
      imports: [TaskDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TaskService, useValue: taskServiceMock },
        { provide: NotificationService, useValue: notificationMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: '7' }),
            },
          },
        },
      ],
    })
      .overrideProvider(MatDialog, {
        useValue: { open: dialogOpenSpy },
      })
      .compileComponents();
  });

  it('should fetch and display task details', () => {
    fixture = TestBed.createComponent(TaskDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(taskServiceMock.getTask).toHaveBeenCalledWith(7);
    expect(compiled.querySelector('[data-testid="detail-title"]')?.textContent).toContain(
      'Complete Laravel API',
    );
    expect(compiled.querySelector('[data-testid="detail-description"]')?.textContent).toContain(
      'Build CRUD API for tasks',
    );
  });

  it('should display error state when task is not found', () => {
    taskServiceMock.getTask.mockReturnValueOnce(
      throwError(() => ({ error: { message: 'Task not found' } })),
    );

    fixture = TestBed.createComponent(TaskDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="task-detail-error"]')).toBeTruthy();
    expect(compiled.textContent).toContain('Task not found');
  });

  it('should open confirmation dialog and delete task when confirmed', () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(TaskDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.confirmDelete();

    expect(dialogOpenSpy).toHaveBeenCalled();
    expect(taskServiceMock.deleteTask).toHaveBeenCalledWith(7);
    expect(notificationMock.success).toHaveBeenCalledWith('Task deleted successfully');
    expect(navSpy).toHaveBeenCalledWith(['/tasks']);
  });

  it('should not delete task when confirmation dialog is cancelled', () => {
    dialogOpenSpy.mockReturnValueOnce({
      afterClosed: () => of(false),
    });

    fixture = TestBed.createComponent(TaskDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.confirmDelete();

    expect(dialogOpenSpy).toHaveBeenCalled();
    expect(taskServiceMock.deleteTask).not.toHaveBeenCalled();
  });
});
