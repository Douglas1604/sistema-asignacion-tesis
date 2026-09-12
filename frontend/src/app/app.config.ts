/**
 * @fileoverview Configuración raíz de la aplicación standalone.
 *
 * Sustituye al antiguo `AppModule`: aquí se registran los proveedores globales
 * (router, cliente HTTP e interceptores) que quedan disponibles en toda la app.
 */
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './interceptors/auth-interceptor';

/** Proveedores de la aplicación, consumidos por `bootstrapApplication` en `main.ts`. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // El interceptor adjunta el token Bearer a las peticiones a la API.
    // `withFetch` hace que HttpClient use la API Fetch nativa del navegador
    // en lugar de XMLHttpRequest.
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
  ],
};
