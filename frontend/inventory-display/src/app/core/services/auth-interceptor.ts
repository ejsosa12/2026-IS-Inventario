import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth-service';

// Runs on every HttpClient request: adds the Bearer token and handles 401 from Flask
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Login has no token yet, and a 401 there means wrong password (the Login component shows it)
  if (req.url === authService.LOGIN_URL) {
    return next(req);
  }

  const token = authService.token();
  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401) {
        // Token expired or invalid: close session and go back to login
        authService.logout();
        router.navigate(['/home/login']);
      }
      return throwError(() => err);
    })
  );
};
