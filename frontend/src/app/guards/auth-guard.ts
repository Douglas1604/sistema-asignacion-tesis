/**
 * @fileoverview Guarda de rutas protegidas.
 *
 * ALCANCE: esto es una mejora de EXPERIENCIA DE USUARIO, no un control de
 * seguridad. Impide mostrar una pantalla vacía a quien no ha iniciado sesión,
 * pero cualquiera puede saltársela manipulando el navegador. La autorización
 * real la aplica el backend en cada endpoint, que exige el token y el rol.
 */

import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';

import { AuthService } from '../services/auth';

/**
 * Guarda funcional de tipo `CanActivate`.
 *
 * @param route Instantánea de la ruta que se intenta activar (no se utiliza).
 * @param state Estado del router; aporta la URL de destino solicitada.
 * @returns `true` para permitir la navegación, o un `UrlTree` hacia `/login`.
 *          Devolver un `UrlTree` (en lugar de navegar y devolver `false`)
 *          permite al router cancelar y redirigir en una sola operación.
 */
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.estaAutenticado()) {
    return true;
  }

  // Guardamos a dónde quería ir para volver ahí tras iniciar sesión.
  return router.createUrlTree(['/login'], {
    queryParams: { redirigir: state.url },
  });
};
