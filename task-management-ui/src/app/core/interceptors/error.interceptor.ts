import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notification = inject(NotificationService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const skipNotification = req.headers.get('X-Skip-Error-Notification') === 'true';

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
