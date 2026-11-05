import { Component, inject } from '@angular/core';
import { AuthService } from '../../core/services/auth-service';

@Component({
  imports: [],
  selector: 'app-toolbar',
  templateUrl: './toolbar.html',
})
export class Toolbar {
  private authService  = inject(AuthService);

  logout(){
    this.authService.logout();
  }

}

