export type TaskStatus = 'Pending' | 'In Progress' | 'Completed';

export type TaskPriority = 'Low' | 'Medium' | 'High';

export const TASK_STATUSES: readonly TaskStatus[] = ['Pending', 'In Progress', 'Completed'];

export const TASK_PRIORITIES: readonly TaskPriority[] = ['Low', 'Medium', 'High'];

export interface TaskUserSummary {
  id: number;
  name: string;
  email: string;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assigned_to_user_id?: number | null;
  created_by?: TaskUserSummary | null;
  assigned_to?: TaskUserSummary | null;
  assigned_by?: TaskUserSummary | null;
  created_at?: string;
  updated_at?: string;
}

export interface TaskPayload {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
  assigned_to_user_id?: number | null;
}

export interface TaskMutationResponse {
  message: string;
  data: Task;
}

export interface TaskDeleteResponse {
  message: string;
}
