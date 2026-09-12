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

/**
 * Interceptor funcional registrado en `app.config.ts` mediante `withInterceptors`.
 *
 * @description Se ejecuta para CADA petición de HttpClient, en dos fases:
 *  - Salida: si hay token y el destino es la API propia, clona la petición
 *    añadiendo `Authorization: Bearer <token>`.
 *  - Entrada: observa la respuesta; ante un 401 de la API cierra la sesión y
 *    redirige al login. El error se relanza para que el componente lo muestre.
 *
 * @param req Petición saliente (inmutable).
 * @param next Siguiente manejador de la cadena de interceptores.
 * @returns Observable de la respuesta HTTP.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // `inject` es válido aquí porque Angular ejecuta el interceptor dentro de
  // un contexto de inyección; no hace falta una clase con constructor.
  const authService = inject(AuthService);
  const router = inject(Router);

  const paraNuestraApi = esPeticionALaApi(req.url);
  const token = authService.obtenerToken();

  // HttpRequest es inmutable por diseño: para añadir la cabecera se crea una
  // copia con `clone`, lo que evita efectos colaterales entre interceptores.
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
