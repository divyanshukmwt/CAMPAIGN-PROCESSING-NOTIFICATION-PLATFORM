import { Routes } from '@angular/router';
import { LoginComponent } from './components/auth/login/login.component';
import { RegisterComponent } from './components/auth/register/register.component';
import { TaskDetailComponent } from './components/task-detail/task-detail.component';
import { TaskFormComponent } from './components/task-form/task-form.component';
import { TaskListComponent } from './components/task-list/task-list.component';
import { authGuard, guestGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'tasks', pathMatch: 'full' },
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [guestGuard],
    title: 'Sign In | Task Management System',
  },
  {
    path: 'register',
    component: RegisterComponent,
    canActivate: [guestGuard],
    title: 'Create Account | Task Management System',
  },
  {
    path: 'tasks',
    component: TaskListComponent,
    canActivate: [authGuard],
    title: 'Tasks | Task Management System',
  },
  {
    path: 'tasks/new',
    component: TaskFormComponent,
    canActivate: [authGuard],
    title: 'Create Task | Task Management System',
  },
  {
    path: 'tasks/:id',
    component: TaskDetailComponent,
    canActivate: [authGuard],
    title: 'Task Details | Task Management System',
  },
  {
    path: 'tasks/:id/edit',
    component: TaskFormComponent,
    canActivate: [authGuard],
    title: 'Edit Task | Task Management System',
  },
  { path: '**', redirectTo: 'tasks' },
];
