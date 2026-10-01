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
import Swal from 'sweetalert2';

import { AuthService } from '../services/auth';
import { environment } from '../../environments/environment';

/**
 * Códigos que invalidan la sesión del cliente.
 *  - 401: el token falta, está mal firmado o ha caducado.
 *  - 403: el token es válido pero la cuenta ya no tiene el rol que la
 *    operación exige (por ejemplo, se le retiró el perfil de administrador).
 * En ambos casos conservar el token solo produce más errores.
 */
const ESTADOS_SIN_SESION = [401, 403];

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
      // Sesión ausente, inválida, caducada o sin permisos: se limpia el estado
      // local y se devuelve al login. Evita quedarse con un token muerto.
      //
      // El propio login se excluye: unas credenciales incorrectas responden
      // 401 y redirigir desde ahí recargaría la pantalla, borrando el mensaje
      // de error antes de que el usuario pudiera leerlo.
      const esLogin = req.url.includes('/auth/login');

      if (paraNuestraApi && !esLogin && ESTADOS_SIN_SESION.includes(error.status)) {
        authService.logout();

        // Sin esto, un diálogo de SweetAlert2 abierto (o su spinner de
        // carga) sobrevive a la navegación: el login queda detrás de un
        // modal que ya no pertenece a ninguna pantalla y la interfaz parece
        // congelada. `Swal.close()` es seguro aunque no haya nada abierto.
        Swal.close();

        // `replaceUrl` sustituye la entrada del historial en lugar de añadir
        // una nueva: así el botón "atrás" no devuelve a la pantalla protegida
        // que acabamos de abandonar. La navegación es asíncrona y su promesa
        // se captura para no dejar un rechazo sin manejar si el router la
        // cancela (por ejemplo, porque ya estamos navegando).
        router
          .navigate(['/login'], {
            replaceUrl: true,
            queryParams: { expirada: '1' },
          })
          .catch(() => undefined);
      }

      // El error se relanza siempre: el componente que hizo la petición debe
      // poder bajar su bandera de "cargando" y mostrar lo que corresponda.
      return throwError(() => error);
    }),
  );
};
