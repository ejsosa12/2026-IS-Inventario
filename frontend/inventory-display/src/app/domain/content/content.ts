import { Component, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../../core/services/auth-service';
import { injectIsPhone } from '../../core/utils/screen';
import { SideBar } from '../../utils/side-bar/side-bar';

// HU-19: on a phone the only page is Existencias (the rest are built for a computer)
const PHONE_PAGE = '/content/stock';

@Component({
  imports: [RouterOutlet, SideBar],
  selector: 'app-content',
  templateUrl: './content.html',
})
export class Content {
  private authService = inject(AuthService);
  private router = inject(Router);

  readonly isPhone = injectIsPhone();
  nombre = this.authService.nombre;
  isAdmin = this.authService.isAdmin;

  private url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  constructor() {
    // Any other page opened on a phone (dashboard after login, a typed URL...) goes to Existencias.
    // Only the UI: Flask still decides what each user can do.
    effect(() => {
      if (this.isPhone() && !this.url().startsWith(PHONE_PAGE)) {
        this.router.navigateByUrl(PHONE_PAGE, { replaceUrl: true });
      }
    });
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/home/login']);
  }
}
