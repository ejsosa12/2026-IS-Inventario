import { Routes } from '@angular/router';

export const routes: Routes = [
   //Home page
  {path: 'home',
    loadComponent: () => import('./domain/home/home').then(h => h.Home),
    children: [
      {
        path: 'login', loadComponent: () => import('./utils/login/login').then((m) => m.Login) },
      {
        path: '', redirectTo: 'login', pathMatch: 'full'
      },
      {
        path : 'register', redirectTo : 'register', pathMatch : 'full'
      }
    ]
  },
    // Redirects user in case route es empty
  {path: '', redirectTo : '/home', pathMatch: 'full'},

  // Redirects user in case page dosent exists
  {path: '**', loadComponent: () => import('./utils/page-not-found/page-not-found').then((p) => p.PageNotFound)}
  //{path: '*', component: PageNotFound}
];
