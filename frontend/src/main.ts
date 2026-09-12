/**
 * @fileoverview Punto de entrada del frontend.
 *
 * Arranca la aplicación standalone: instancia el componente raíz `App` con los
 * proveedores globales de `appConfig` (router, HttpClient e interceptor).
 */
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
