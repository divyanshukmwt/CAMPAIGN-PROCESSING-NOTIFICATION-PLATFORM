import { Routes } from '@angular/router';
import { TaskDetailComponent } from './components/task-detail/task-detail.component';
import { TaskFormComponent } from './components/task-form/task-form.component';
import { TaskListComponent } from './components/task-list/task-list.component';

export const routes: Routes = [
  { path: '', redirectTo: 'tasks', pathMatch: 'full' },
  { path: 'tasks', component: TaskListComponent, title: 'Tasks | Task Management System' },
  { path: 'tasks/new', component: TaskFormComponent, title: 'Create Task | Task Management System' },
  { path: 'tasks/:id', component: TaskDetailComponent, title: 'Task Details | Task Management System' },
  { path: 'tasks/:id/edit', component: TaskFormComponent, title: 'Edit Task | Task Management System' },
];
