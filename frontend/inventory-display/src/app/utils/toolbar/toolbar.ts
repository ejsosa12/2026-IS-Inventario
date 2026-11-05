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
    // TODO: logout function
    // this.authService.logout();
  }

}

