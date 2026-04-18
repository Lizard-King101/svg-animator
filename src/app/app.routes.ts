import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full'
    },
    {
        path: 'home',
        loadComponent: () => import('./home/home.page').then(m => m.HomePage)
    },
    {
        path: 'editor',
        loadComponent: () => import('./editor/editor.page').then(m => m.EditorPage)
    },
    {
        path: '**',
        redirectTo: 'home',
        pathMatch: 'full'
    }
];
