import { Component, inject } from '@angular/core';
import { AuthService } from '../../core/services/auth-service';
import { Router } from '@angular/router';

@Component({
  imports: [],
  selector: 'app-side-bar',
  templateUrl: './side-bar.html',
})
export class SideBar {
  private authService  = inject(AuthService);
  private router = inject(Router)

  logout(){
    this.authService.logout();
    this.router.navigate(['/home/login'])
  }

}

