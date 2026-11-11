import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  Task,
  TaskDeleteResponse,
  TaskMutationResponse,
  TaskPayload,
} from '../models/task';

@Injectable({
  providedIn: 'root',
})
export class TaskService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/tasks`;

  getTasks(search?: string, userId?: number | null): Observable<Task[]> {
    let params = new HttpParams();
    const trimmed = search?.trim();
    if (trimmed) {
      params = params.set('search', trimmed);
    }
    if (userId !== undefined && userId !== null) {
      params = params.set('user_id', String(userId));
    }
    return this.http.get<Task[]>(this.apiUrl, { params });
  }

  getTask(id: number): Observable<Task> {
    return this.http.get<Task>(`${this.apiUrl}/${id}`);
  }

  createTask(task: TaskPayload): Observable<TaskMutationResponse> {
    return this.http.post<TaskMutationResponse>(this.apiUrl, task);
  }

  updateTask(id: number, task: Partial<TaskPayload>): Observable<TaskMutationResponse> {
    return this.http.put<TaskMutationResponse>(`${this.apiUrl}/${id}`, task);
  }

  deleteTask(id: number): Observable<TaskDeleteResponse> {
    return this.http.delete<TaskDeleteResponse>(`${this.apiUrl}/${id}`);
  }
}
