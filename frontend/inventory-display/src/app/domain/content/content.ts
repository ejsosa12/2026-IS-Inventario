import { Component, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../../core/services/auth-service';
import { injectIsPhone } from '../../core/utils/screen';
import { SideBar } from '../../utils/side-bar/side-bar';

// HU-19: on a phone only these pages exist (the rest are built for a computer).
// HU-23's order list is owner only; for an employee its adminGuard ends back in Existencias.
const PHONE_HOME = '/content/stock';
const PHONE_PAGES = [PHONE_HOME, '/content/suppliers/order'];

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SideBar],
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
    // null until the navigation that opened /content ends (router.url is still the old page then)
    { initialValue: null },
  );

  constructor() {
    // Any other page opened on a phone (dashboard after login, a typed URL...) goes to Existencias.
    // Only the UI: Flask still decides what each user can do.
    effect(() => {
      const url = this.url()?.split(/[?#]/)[0];
      if (url && this.isPhone() && !PHONE_PAGES.includes(url)) {
        this.router.navigateByUrl(PHONE_HOME, { replaceUrl: true });
      }
    });
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/home/login']);
  }
}
