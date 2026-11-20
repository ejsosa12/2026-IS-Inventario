import { inject } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router } from '@angular/router';
import { AuthService } from '../services/auth-service';

// HU-29: owner-only pages (prices, users...). An employee who types the URL sees the 404 page,
// as if the page did not exist; skipLocationChange keeps the typed address in the bar.
// Flask still answers 403, this only keeps the employee from seeing a form they cannot save
export const adminGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAdmin()) {
    return true;
  }
  return new RedirectCommand(router.parseUrl('/not-found'), { skipLocationChange: true });
};
