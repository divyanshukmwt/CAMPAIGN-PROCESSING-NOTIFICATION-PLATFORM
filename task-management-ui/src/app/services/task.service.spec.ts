import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { Task, TaskPayload } from '../models/task';
import { TaskService } from './task.service';

describe('TaskService', () => {
  let service: TaskService;
  let httpMock: HttpTestingController;
  const baseUrl = `${environment.apiUrl}/tasks`;

  const sampleTask: Task = {
    id: 1,
    title: 'Complete Laravel API',
    description: 'Build CRUD API for tasks',
    status: 'In Progress',
    priority: 'High',
    due_date: '2026-03-20',
    created_at: '2026-03-14T10:00:00.000000Z',
    updated_at: '2026-03-14T10:00:00.000000Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TaskService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TaskService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should fetch all tasks via GET /api/tasks', () => {
    let tasks: Task[] = [];
    service.getTasks().subscribe((res) => (tasks = res));

    const req = httpMock.expectOne(baseUrl);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush([sampleTask]);

    expect(tasks).toEqual([sampleTask]);
  });

  it('should pass trimmed search query parameter via GET /api/tasks?search=...', () => {
    service.getTasks('  Laravel  ').subscribe();

    const req = httpMock.expectOne((r) => r.url === baseUrl && r.params.get('search') === 'Laravel');
    expect(req.request.method).toBe('GET');
    req.flush([sampleTask]);
  });

  it('should pass user_id query parameter when filtering by user in Admin view', () => {
    service.getTasks('', 5).subscribe();

    const req = httpMock.expectOne((r) => r.url === baseUrl && r.params.get('user_id') === '5');
    expect(req.request.method).toBe('GET');
    req.flush([sampleTask]);
  });

  it('should fetch a single task via GET /api/tasks/:id', () => {
    let result: Task | undefined;
    service.getTask(1).subscribe((res) => (result = res));

    const req = httpMock.expectOne(`${baseUrl}/1`);
    expect(req.request.method).toBe('GET');
    req.flush(sampleTask);

    expect(result).toEqual(sampleTask);
  });

  it('should create a task via POST /api/tasks', () => {
    const payload: TaskPayload = {
      title: 'Prepare Angular UI',
      description: 'Create task list and forms',
      status: 'Pending',
      priority: 'Medium',
      due_date: '2026-03-22',
    };

    let responseMessage = '';
    service.createTask(payload).subscribe((res) => (responseMessage = res.message));

    const req = httpMock.expectOne(baseUrl);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush({
      message: 'Task created successfully',
      data: { ...sampleTask, ...payload, id: 2 },
    });

    expect(responseMessage).toBe('Task created successfully');
  });

  it('should update a task via PUT /api/tasks/:id', () => {
    const payload: Partial<TaskPayload> = {
      title: 'Prepare Angular UI Updated',
      status: 'Completed',
      priority: 'High',
    };

    let updatedStatus = '';
    service.updateTask(1, payload).subscribe((res) => (updatedStatus = res.data.status));

    const req = httpMock.expectOne(`${baseUrl}/1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(payload);
    req.flush({
      message: 'Task updated successfully',
      data: { ...sampleTask, ...payload },
    });

    expect(updatedStatus).toBe('Completed');
  });

  it('should delete a task via DELETE /api/tasks/:id', () => {
    let deleteMessage = '';
    service.deleteTask(1).subscribe((res) => (deleteMessage = res.message));

    const req = httpMock.expectOne(`${baseUrl}/1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: 'Task deleted successfully' });

    expect(deleteMessage).toBe('Task deleted successfully');
  });
});
