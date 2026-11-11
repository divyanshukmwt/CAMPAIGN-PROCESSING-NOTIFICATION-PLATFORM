import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../services/notification.service';
import { TabLockService } from '../services/tab-lock.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notification = inject(NotificationService);
  const authService = inject(AuthService);
  const tabLock = inject(TabLockService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const skipNotification = req.headers.get('X-Skip-Error-Notification') === 'true';

      if (error.status === 401) {
        authService.clearSession();
        if (!req.url.endsWith('/api/user') && !req.url.endsWith('/api/login')) {
          void router.navigate(['/login']);
        }
      }

      if (error.status === 409 && error.error?.code === 'TAB_CONFLICT') {
        tabLock.markConflictFromServer(error.error?.message);
      }

      if (!skipNotification) {
        const apiMessage: string | undefined = error.error?.message;

        switch (error.status) {
          case 0:
            notification.error('Unable to reach the server. Please check your connection.');
            break;
          case 401:
            if (!req.url.endsWith('/api/user')) {
              notification.error(apiMessage || 'Your session has expired. Please sign in.');
            }
            break;
          case 403:
            notification.error(apiMessage || 'You are not authorized to perform this action.');
            break;
          case 404:
            notification.error(apiMessage || 'The requested resource was not found.');
            break;
          case 409:
            notification.error(
              apiMessage || 'Active session is locked to another browser tab.',
            );
            break;
          case 422:
            notification.error(apiMessage || 'Please correct the highlighted validation errors.');
            break;
          case 429:
            notification.error(apiMessage || 'Too many requests. Please wait a moment and try again.');
            break;
          default:
            notification.error(apiMessage || 'An unexpected server error occurred.');
            break;
        }
      }

      return throwError(() => error);
    }),
  );
};
