import { Component, inject } from '@angular/core';
import { AuthService } from '../../core/services/auth-service';
import { Router, RouterLink } from '@angular/router';

@Component({
  imports: [RouterLink],
  selector: 'app-side-bar',
  templateUrl: './side-bar.html',
})
export class SideBar {
  private authService  = inject(AuthService);
  private router = inject(Router)

  // HU-29: the employee does not see the options they cannot use
  isAdmin = this.authService.isAdmin;
  nombre = this.authService.nombre;

  logout(){
    this.authService.logout();
    this.router.navigate(['/home/login'])
  }

}
