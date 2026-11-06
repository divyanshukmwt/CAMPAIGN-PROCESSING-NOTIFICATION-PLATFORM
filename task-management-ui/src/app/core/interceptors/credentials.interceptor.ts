import { DOCUMENT } from '@angular/common';
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(cookieString: string, name: string): string | null {
  if (!cookieString) {
    return null;
  }
  const cookies = cookieString.split(';');
  for (const rawCookie of cookies) {
    const [key, ...rest] = rawCookie.trim().split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  const doc = inject(DOCUMENT);
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (MUTATING_METHODS.has(req.method.toUpperCase())) {
    const xsrfToken = readCookie(doc.cookie ?? '', 'XSRF-TOKEN');
    if (xsrfToken && !req.headers.has('X-XSRF-TOKEN')) {
      headers['X-XSRF-TOKEN'] = xsrfToken;
    }
  }

  const cloned = req.clone({
    withCredentials: true,
    setHeaders: headers,
  });

  return next(cloned);
};
