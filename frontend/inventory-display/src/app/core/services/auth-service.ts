import { HttpClient } from '@angular/common/http';
import { computed, inject, Service, signal } from '@angular/core';
import { tap } from 'rxjs';

export type Rol = 'admin' | 'employee';

// What Flask puts inside the JWT (backend/app/auth/auth_user.py)
interface TokenPayload {
  email: string;
  nombre?: string;
  rol?: Rol;
  exp: number;
}

// Reads the JWT payload. Only for the UI: Flask is the one that verifies the signature
function decodeToken(token: string | null): TokenPayload | null {
  if (!token) {
    return null;
  }
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    // atob gives bytes; TextDecoder turns them back into UTF-8 ("José" and not "JosÃ©")
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null; // malformed token = invalid
  }
}

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

  private payload = computed(() => decodeToken(this._token()));

  // HU-29: who is logged in. A token from before this change has no rol, so it counts as employee
  email = computed(() => this.payload()?.email ?? '');
  nombre = computed(() => this.payload()?.nombre ?? this.email());
  rol = computed<Rol>(() => this.payload()?.rol ?? 'employee');
  isAdmin = computed(() => this.rol() === 'admin');

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
    const payload = decodeToken(token);
    if (!payload) {
      return true; // malformed token = invalid
    }
    return Date.now() >= payload.exp * 1000; // exp comes in seconds
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
    // Whatever was hidden during this session shows again on the next login (e.g. HU-22 notification)
    sessionStorage.clear();
    this._token.set(null);
  }
}
