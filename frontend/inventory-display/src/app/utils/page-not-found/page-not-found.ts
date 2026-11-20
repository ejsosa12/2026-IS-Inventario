import { Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

@Component({
  imports: [RouterLink],
  selector: 'app-page-not-found',
  styleUrl: './page-not-found.css',
  templateUrl: './page-not-found.html',
})
export class PageNotFound {
  private readonly location = inject(Location);
  private readonly router = inject(Router);

  // The address in the bar, so the user sees what was not found. Location, not Router.url:
  // when adminGuard redirects here with skipLocationChange, Router.url would be '/not-found'
  readonly url = this.location.path() || this.router.url;

  // Back to the previous page; with no history (a typed URL) go to the start.
  // "Ir al inicio" goes to the dashboard: authGuard sends a logged-out user to the login
  back(): void {
    if (history.length > 1) {
      this.location.back();
    } else {
      this.router.navigateByUrl('/content/dashboard');
    }
  }
}
