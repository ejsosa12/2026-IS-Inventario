import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth-service';

@Component({
  imports: [FormsModule],
  selector: 'app-login',
  styleUrl: './login.css',
  templateUrl: './login.html',
})
export class Login {
  private authService = inject(AuthService);
  private router = inject(Router);

  email: string = '';
  password: string = '';
  empty_entrie: boolean = false;

  loading = this.authService.loading;
  error = this.authService.error;

  login() {
    this.empty_entrie = false;

    if (this.email === '' || this.password === '') {
      this.empty_entrie = true;
      return;
    }

    // Password goes in plain text: Flask hashes it before comparing
    this.authService.login({ email: this.email, password: this.password }).subscribe({
      next: () => this.router.navigate(['/content']),
      error: () => {}, // the message is already stored in authService.error
    });
  }
}
