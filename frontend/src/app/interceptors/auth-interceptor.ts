/**
 * @fileoverview Interceptor HTTP de autenticación.
 *
 * Añade el token Bearer a las peticiones dirigidas a NUESTRA API y reacciona
 * a un 401 cerrando la sesión. Al centralizarlo aquí, ningún servicio ni
 * componente manipula la cabecera Authorization por su cuenta.
 */

import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { AuthService } from '../services/auth';
import { environment } from '../../environments/environment';

/**
 * Comprueba que la URL apunta realmente a la API configurada.
 *
 * La comparación es sobre el ORIGEN ya resuelto, no un `startsWith` sobre la
 * cadena: así una URL como `https://atacante.example/?x=http://localhost:3000`
 * no se confunde con la API y el token no se filtra a un tercero.
 *
 * @param url URL de la petición saliente.
 * @returns true si la petición va a la API propia.
 */
function esPeticionALaApi(url: string): boolean {
  try {
    // `document.baseURI` resuelve las rutas relativas (p. ej. '/api/v1/...').
    const destino = new URL(url, document.baseURI);
    const api = new URL(environment.apiUrl, document.baseURI);

    return (
      destino.origin === api.origin && destino.pathname.startsWith(api.pathname)
    );
  } catch {
    return false;
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const paraNuestraApi = esPeticionALaApi(req.url);
  const token = authService.obtenerToken();

  const peticion =
    token && paraNuestraApi
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

  return next(peticion).pipe(
    catchError((error: HttpErrorResponse) => {
      // 401 significa sesión ausente, inválida o caducada: limpiamos el estado
      // local y devolvemos al login. Evita quedarse con un token muerto.
      if (error.status === 401 && paraNuestraApi) {
        authService.logout();
        router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
