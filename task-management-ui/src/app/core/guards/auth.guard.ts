import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../../services/auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.ensureSessionLoaded().pipe(
    map((authenticated) => {
      if (authenticated) {
        return true;
      }
      return router.createUrlTree(['/login'], {
        queryParams: state.url && state.url !== '/tasks' ? { returnUrl: state.url } : undefined,
      });
    }),
  );
};

export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.ensureSessionLoaded().pipe(
    map((authenticated) => (authenticated ? router.createUrlTree(['/tasks']) : true)),
  );
};
