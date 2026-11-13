// Same shapes Flask returns in backend/app/users/users.py
import { Rol } from '../core/services/auth-service';

// One row of GET /api/v1/users (never includes the password)
export interface User {
  id: number;
  nombre: string;
  email: string;
  rol: Rol; // HU-30: chosen when the user is created, cannot be changed
  activo: boolean;
}

// What the form sends to POST /api/v1/add-user
export interface NewUser {
  nombre: string;
  email: string;
  rol: Rol;
  password: string;
}
