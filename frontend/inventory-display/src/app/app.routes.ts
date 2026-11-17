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
        // HU-21 (mínimo) and HU-02 (precios): owner only
        path: 'products/edit-product/:id', canActivate: [adminGuard], loadComponent: () => import('./utils/edit-product/edit-product').then(e => e.EditProduct)
      },
      {
        // HU-20: kárdex of one product. Owner only
        path: 'products/history/:id', canActivate: [adminGuard], loadComponent: () => import('./utils/product-history/product-history').then(h => h.ProductHistory)
      },
      {
        path: 'suppliers', loadComponent: () => import('./utils/suppliers/suppliers').then(s => s.Suppliers)
      },
      {
        path: 'suppliers/add-supplier', canActivate: [adminGuard], loadComponent: () => import('./utils/add-supplier/add-supplier').then(a => a.AddSupplier)
      },
      {
        // HU-09: same form as add-supplier, filled with the supplier
        path: 'suppliers/edit-supplier/:id', canActivate: [adminGuard], loadComponent: () => import('./utils/add-supplier/add-supplier').then(a => a.AddSupplier)
      },
      {
        // HU-30: only the owner manages users
        path: 'users', canActivate: [adminGuard], loadComponent: () => import('./utils/users/users').then(u => u.Users)
      },
      {
        path: 'users/add-user', canActivate: [adminGuard], loadComponent: () => import('./utils/add-user/add-user').then(a => a.AddUser)
      },
      {
        path: 'entries', loadComponent: () => import('./utils/entries/entries').then(e => e.Entries)
      },
      {
        // HU-14: same form as entries, filled with the entry to correct. Owner only
        path: 'entries/correct/:id', canActivate: [adminGuard], loadComponent: () => import('./utils/entries/entries').then(e => e.Entries)
      },
      {
        // HU-16: merma (and HU-17 uso interno later). Any logged-in user
        path: 'outputs', loadComponent: () => import('./utils/outputs/outputs').then(o => o.Outputs)
      },
      {
        path: 'entries-list', loadComponent: () => import('./utils/entries-list/entries-list').then(el => el.EntriesList)
      },
      {
        path: 'outputs', loadComponent: () => import('./utils/outputs/outputs').then(o => o.Outputs)
      },
      {
        // HU-32/33/34: physical count. Anyone starts one; the owner applies it
        path: 'counts', loadComponent: () => import('./utils/counts/counts').then(c => c.Counts)
      },
      {
        // HU-33: system stock vs counted, with the money. Owner only
        path: 'counts/compare/:id', canActivate: [adminGuard], loadComponent: () => import('./utils/count-compare/count-compare').then(c => c.CountCompare)
      },
      {
        // HU-26 (and future reports): money, owner only
        path: 'reports', canActivate: [adminGuard], loadComponent: () => import('./utils/reports/reports').then(r => r.Reports)
      },
      {
        // HU-05: only the owner manages categories
        path: 'categories', canActivate: [adminGuard], loadComponent: () => import('./utils/categories/categories').then(c => c.Categories)
      },
      {
        // HU-05: only the owner manages categories
        path: 'reports', canActivate: [adminGuard], loadComponent: () => import('./utils/reports/reports').then(r => r.Reports)
      },
    ]
  },

  // HU-32: the count sheets, outside 'content' so they print without the sidebar
  {path: 'print/count/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./utils/count-sheet/count-sheet').then(c => c.CountSheet)
  },

    // Redirects user in case route es empty
  {path: '', redirectTo : '/home', pathMatch: 'full'},

  // Redirects user in case page dosent exists
  {path: '**', loadComponent: () => import('./utils/page-not-found/page-not-found').then((p) => p.PageNotFound)}
  //{path: '*', component: PageNotFound}
];
