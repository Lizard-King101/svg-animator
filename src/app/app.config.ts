import { ApplicationConfig, ENVIRONMENT_INITIALIZER, inject, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { far } from '@fortawesome/free-regular-svg-icons';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
    providers: [
        provideZoneChangeDetection({ eventCoalescing: false }),
        provideRouter(routes),
        {
            provide: ENVIRONMENT_INITIALIZER,
            useValue: () => inject(FaIconLibrary).addIconPacks(fas, far),
            multi: true
        }
    ]
};
