import { HttpClient } from '@angular/common/http';
import { inject, Service, signal } from '@angular/core';
import { tap } from 'rxjs';

export interface LoginRequest {
  email: string;
  password: string;
}

// Same shape Flask returns in backend/app/auth/auth_user.py
export interface LoginResponse {
  status: number;
  message: string;
  token: string | null;
}

@Service()
export class AuthService {
  private readonly API_URL = 'http://localhost:5000/api/v1';
  readonly LOGIN_URL = `${this.API_URL}/login`;

  private http = inject(HttpClient);
  private _token = signal<string | null>(localStorage.getItem('token'));
  private _loading = signal(false);
  private _error = signal<string | null>(null);

  token = this._token.asReadonly();
  loading = this._loading.asReadonly();
  error = this._error.asReadonly();

  // A method, not a computed: a computed would not re-run just because time passed
  isAuthenticated(): boolean {
    const token = this._token();
    if (!token) {
      return false;
    }
    if (this.isTokenExpired(token)) {
      this.logout();
      return false;
    }
    return true;
  }

  // Reads "exp" from the JWT payload. This is only for UX: Flask is the one that verifies the signature
  private isTokenExpired(token: string): boolean {
    try {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64));
      return Date.now() >= payload.exp * 1000; // exp comes in seconds
    } catch {
      return true; // malformed token = invalid
    }
  }

  login(credentials: LoginRequest) {
    this._loading.set(true);
    this._error.set(null);

    return this.http.post<LoginResponse>(this.LOGIN_URL, credentials).pipe(
      tap({
        next: (response) => {
          if (response.token) {
            localStorage.setItem('token', response.token);
          }
          this._token.set(response.token);
          this._loading.set(false);
        },
        error: (err) => {
          // Flask sends its own message in the body (e.g. "ERROR: User does not exist")
          this._error.set(err.error?.message || 'Login incorrecto');
          this._loading.set(false);
        },
      })
    );
  }

  logout() {
    localStorage.removeItem('token');
    this._token.set(null);
  }
}
