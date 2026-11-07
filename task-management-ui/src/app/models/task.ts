export type TaskStatus = 'Pending' | 'In Progress' | 'Completed';

export type TaskPriority = 'Low' | 'Medium' | 'High';

export const TASK_STATUSES: readonly TaskStatus[] = ['Pending', 'In Progress', 'Completed'];

export const TASK_PRIORITIES: readonly TaskPriority[] = ['Low', 'Medium', 'High'];

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TaskPayload {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
}

export interface TaskMutationResponse {
  message: string;
  data: Task;
}

export interface TaskDeleteResponse {
  message: string;
}
