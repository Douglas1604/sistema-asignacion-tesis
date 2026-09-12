/**
 * @fileoverview Archivo central de enrutamiento (Router) de la aplicación Angular.
 * Aquí definimos el mapa de navegación del sistema, asociando cada URL
 * con su pantalla (componente) correspondiente para manejar el flujo del usuario.
 *
 * NOTA DE SEGURIDAD: la guarda `authGuard` mejora la experiencia de uso, pero
 * NO protege datos. Un usuario puede saltársela manipulando el navegador; lo
 * único que obtendría es una pantalla vacía, porque cada petición al backend
 * exige un token válido y el rol adecuado. La autorización vive en el servidor.
 */

import { Routes } from '@angular/router';

// Importación de las pantallas principales del sistema
import { LoginComponent } from './pages/login/login';
import { DashboardComponent } from './pages/dashboard/dashboard';
import { SorteoComponent } from './pages/sorteo/sorteo';
import { ReportesComponent } from './pages/reportes/reportes';
import { authGuard } from './guards/auth-guard';

export const routes: Routes = [
  // Ruta pública: es la única alcanzable sin sesión iniciada.
  { path: 'login', component: LoginComponent },

  // Pantallas internas: requieren sesión.
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'sorteo', component: SorteoComponent, canActivate: [authGuard] },
  { path: 'reportes', component: ReportesComponent, canActivate: [authGuard] },

  // Regla por defecto: si el usuario entra a la raíz de la app (ej. localhost:4200/),
  // lo redirigimos automáticamente a la pantalla de inicio de sesión.
  { path: '', redirectTo: 'login', pathMatch: 'full' },

  // Regla de seguridad (Wildcard): si alguien escribe una URL que no existe
  // en el navegador (ej. localhost:4200/cualquiercosa), el sistema lo atrapa
  // y lo devuelve al login para evitar errores de pantalla en blanco (404).
  //
  // El destino es una ruta interna fija, nunca un valor tomado de la URL: así
  // no se puede usar como redirección abierta hacia un sitio externo.
  { path: '**', redirectTo: 'login' }
];
