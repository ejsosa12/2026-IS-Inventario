import { Routes } from '@angular/router';
import { publicGuard } from './core/guards/public-guard';
import { authGuard } from './core/guards/auth-guard';
import { adminGuard } from './core/guards/admin-guard';

export const routes: Routes = [
   //Home page
  {path: 'home',
    canActivate: [publicGuard],
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

  {path: 'content',
    canActivate: [authGuard],
    loadComponent: () => import('./domain/content/content').then(c => c.Content),
    children : [
      {
        path : '', redirectTo : 'dashboard', pathMatch : 'full'
      },
      {
        path: 'dashboard', loadComponent: () => import('./utils/dashboard/dashboard').then(d => d.Dashboard)
      },
      {
        path: 'settings', loadComponent: () => import('./utils/settings/settings').then(s => s.Settings)
      },
      {
        path: 'products', loadComponent: () => import('./utils/products/products').then(p => p.Products)
      },
      {
        path: 'products/add-product', canActivate: [adminGuard], loadComponent: () => import('./utils/add-product/add-product').then(a => a.AddProduct)
      },
      {
        path: 'suppliers', loadComponent: () => import('./utils/suppliers/suppliers').then(s => s.Suppliers)
      },
      {
        path: 'suppliers/add-supplier', canActivate: [adminGuard], loadComponent: () => import('./utils/add-supplier/add-supplier').then(a => a.AddSupplier)
      },
      {
        path: 'entries', loadComponent: () => import('./utils/entries/entries').then(e => e.Entries)
      },
      {
        path: 'entries-list', loadComponent: () => import('./utils/entries-list/entries-list').then(el => el.EntriesList)
      },
    ]
  },

    // Redirects user in case route es empty
  {path: '', redirectTo : '/home', pathMatch: 'full'},

  // Redirects user in case page dosent exists
  {path: '**', loadComponent: () => import('./utils/page-not-found/page-not-found').then((p) => p.PageNotFound)}
  //{path: '*', component: PageNotFound}
];
