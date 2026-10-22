import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full'
    },
    {
        path: 'home',
        title: 'SVG Animator — Create and Export Animated SVGs',
        loadComponent: () => import('./home/home.page').then(m => m.HomePage)
    },
    {
        path: 'editor',
        title: 'Editor — SVG Animator',
        loadComponent: () => import('./editor/editor.page').then(m => m.EditorPage)
    },
    {
        path: '**',
        redirectTo: 'home',
        pathMatch: 'full'
    }
];
