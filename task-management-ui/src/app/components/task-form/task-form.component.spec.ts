import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { NotificationService } from '../../core/services/notification.service';
import { Task } from '../../models/task';
import { TaskService } from '../../services/task.service';
import { TaskFormComponent } from './task-form.component';

describe('TaskFormComponent', () => {
  let component: TaskFormComponent;
  let fixture: ComponentFixture<TaskFormComponent>;
  let taskServiceMock: {
    getTask: ReturnType<typeof vi.fn>;
    createTask: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
  };
  let notificationMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };
  let routeParamId: string | null = null;

  const existingTask: Task = {
    id: 5,
    title: 'Complete Laravel API',
    description: 'Build CRUD API for tasks',
    status: 'In Progress',
    priority: 'High',
    due_date: '2026-03-20',
  };

  beforeEach(async () => {
    routeParamId = null;

    taskServiceMock = {
      getTask: vi.fn().mockReturnValue(of(existingTask)),
      createTask: vi.fn().mockReturnValue(
        of({
          message: 'Task created successfully',
          task: existingTask,
        }),
      ),
      updateTask: vi.fn().mockReturnValue(
        of({
          message: 'Task updated successfully',
          task: existingTask,
        }),
      ),
    };

    notificationMock = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [TaskFormComponent],
      providers: [
        provideRouter([]),
        { provide: TaskService, useValue: taskServiceMock },
        { provide: NotificationService, useValue: notificationMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get paramMap() {
                return convertToParamMap(routeParamId ? { id: routeParamId } : {});
              },
            },
          },
        },
      ],
    }).compileComponents();
  });

  it('should initialize in create mode with default status Pending and priority Medium', () => {
    fixture = TestBed.createComponent(TaskFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.isEditMode()).toBe(false);
    expect(component.form.getRawValue()).toEqual({
      title: '',
      description: '',
      status: 'Pending',
      priority: 'Medium',
      due_date: '',
    });
  });

  it('should block submission when title is empty', () => {
    fixture = TestBed.createComponent(TaskFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.onSubmit();

    expect(component.form.invalid).toBe(true);
    expect(taskServiceMock.createTask).not.toHaveBeenCalled();
  });

  it('should submit createTask and navigate to /tasks on valid create submission', () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(TaskFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.form.setValue({
      title: '  New Sprint Task  ',
      description: '  Deliver UI  ',
      status: 'Pending',
      priority: 'High',
      due_date: '2026-03-25',
    });

    component.onSubmit();

    expect(taskServiceMock.createTask).toHaveBeenCalledWith({
      title: 'New Sprint Task',
      description: 'Deliver UI',
      status: 'Pending',
      priority: 'High',
      due_date: '2026-03-25',
    });
    expect(notificationMock.success).toHaveBeenCalledWith('Task created successfully');
    expect(navSpy).toHaveBeenCalledWith(['/tasks']);
  });

  it('should load existing task in edit mode and submit updateTask', () => {
    routeParamId = '5';
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(TaskFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.isEditMode()).toBe(true);
    expect(taskServiceMock.getTask).toHaveBeenCalledWith(5);
    expect(component.form.controls.title.value).toBe('Complete Laravel API');

    component.form.controls.status.setValue('Completed');
    component.onSubmit();

    expect(taskServiceMock.updateTask).toHaveBeenCalledWith(5, {
      title: 'Complete Laravel API',
      description: 'Build CRUD API for tasks',
      status: 'Completed',
      priority: 'High',
      due_date: '2026-03-20',
    });
    expect(notificationMock.success).toHaveBeenCalledWith('Task updated successfully');
    expect(navSpy).toHaveBeenCalledWith(['/tasks']);
  });

  it('should map backend 422 validation errors onto form controls', () => {
    const validationError = new HttpErrorResponse({
      status: 422,
      statusText: 'Unprocessable Content',
      error: {
        message: 'The due date field must be a valid date.',
        errors: {
          due_date: ['The due date field must be a valid date.'],
        },
      },
    });
    taskServiceMock.createTask.mockReturnValueOnce(throwError(() => validationError));

    fixture = TestBed.createComponent(TaskFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.form.patchValue({
      title: 'Task with bad date',
      due_date: '2026-03-20',
    });

    component.onSubmit();

    expect(component.form.controls.due_date.getError('serverError')).toBe(
      'The due date field must be a valid date.',
    );
  });
});
