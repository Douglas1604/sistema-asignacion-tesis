/**
 * @fileoverview Servicio de autenticación.
 *
 * ESTRATEGIA: el backend usa JWT Bearer, así que el token debe viajar en la
 * cabecera Authorization y el cliente necesita poder leerlo. Eso descarta las
 * cookies httpOnly, que serían preferibles pero requieren que el servidor
 * gestione sesiones por cookie (ver README: "Supuestos del contrato").
 *
 * Consecuencia asumida: el token vive en localStorage y es legible por
 * JavaScript. La mitigación real frente a XSS es no generar HTML con datos no
 * confiables (ver core/excel-seguro.ts y el uso de `text:` en los diálogos),
 * más una caducidad corta del token en el servidor.
 *
 * Se guarda lo mínimo: el token y una identidad reducida para la interfaz.
 * NUNCA se guarda la contraseña ni ningún hash.
 */

import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';

import { environment } from '../../environments/environment';
import { ApiResponse, LoginRequest, LoginData, SesionLocal, Usuario } from '../models/api';

/** Claves del almacenamiento del navegador. */
const CLAVE_TOKEN = 'auth_token';
const CLAVE_SESION = 'auth_session';

/**
 * Servicio singleton que gestiona el ciclo de vida de la sesión en el cliente:
 * inicio, persistencia, restauración al recargar y cierre.
 *
 * @description El estado se expone mediante Signals de Angular: `sesion` y
 * `autenticado` se recalculan automáticamente cuando cambia `sesionActual`,
 * sin necesidad de suscripciones manuales en los componentes.
 */
@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly apiUrl = `${environment.apiUrl}/auth`;

  /** Sesión actual, reactiva para que la interfaz reaccione al login/logout. */
  private readonly sesionActual = signal<SesionLocal | null>(this.leerSesion());

  /** Sesión en curso, o null. */
  readonly sesion = this.sesionActual.asReadonly();

  /** Indica si hay sesión iniciada. */
  readonly autenticado = computed(() => this.sesionActual() !== null);

  constructor(private http: HttpClient) {}

  /**
   * Inicia sesión y guarda las credenciales para las peticiones posteriores.
   *
   * @param credenciales Correo y contraseña en claro; el servidor los verifica.
   * @returns Datos de la sesión iniciada.
   * @throws {HttpErrorResponse} Emitido por el Observable ante 401, 422 o 429.
   *
   * @description Pipeline RxJS: `map` desenvuelve la envoltura `{success, data}`
   * y `tap` persiste la sesión como efecto secundario sin alterar el valor
   * emitido. Al ser un Observable frío, la petición HTTP no se envía hasta que
   * el componente se suscribe.
   */
  login(credenciales: LoginRequest): Observable<LoginData> {
    return this.http
      .post<ApiResponse<LoginData>>(`${this.apiUrl}/login`, credenciales)
      .pipe(
        map((respuesta) => respuesta.data),
        tap((data) => this.guardarSesion(data)),
      );
  }

  /**
   * Cierra la sesión borrando todo el estado de autenticación del cliente.
   * El token deja de enviarse de inmediato porque el interceptor lo lee de aquí.
   */
  logout(): void {
    this.borrarAlmacenamiento();
    this.sesionActual.set(null);
  }

  /**
   * Consulta el perfil completo al servidor.
   * Se pide bajo demanda en vez de guardarlo: así el cliente no conserva datos
   * que podrían quedar obsoletos (por ejemplo, un cambio de rol).
   */
  perfil(): Observable<Usuario> {
    return this.http
      .get<ApiResponse<Usuario>>(`${this.apiUrl}/me`)
      .pipe(map((respuesta) => respuesta.data));
  }

  /**
   * Token de acceso actual, o null si no hay sesión.
   * Se lee de `localStorage` en cada llamada (no de memoria) para reflejar de
   * inmediato un cierre de sesión realizado en otra parte de la aplicación.
   * @returns El JWT en formato compacto, o null.
   */
  obtenerToken(): string | null {
    try {
      return localStorage.getItem(CLAVE_TOKEN);
    } catch {
      // El almacenamiento puede estar bloqueado (modo privado, políticas).
      return null;
    }
  }

  /**
   * Identidad mínima del usuario en sesión.
   * @returns La sesión en memoria, o null.
   */
  obtenerSesion(): SesionLocal | null {
    return this.sesionActual();
  }

  /**
   * Indica si hay sesión iniciada.
   *
   * Es una comprobación de CONVENIENCIA para la interfaz. No es una medida de
   * seguridad: la validez real del token la decide el backend en cada petición.
   * No se decodifica ni se comprueba la expiración del JWT en el cliente: un
   * token caducado provocará un 401 que el interceptor gestiona cerrando sesión.
   *
   * @returns true si existe un token almacenado.
   */
  estaAutenticado(): boolean {
    return this.obtenerToken() !== null;
  }

  /**
   * Persiste el token y la identidad reducida.
   * Del usuario se conservan solo id, email y rol: lo que la interfaz muestra.
   * @param data Respuesta del login.
   */
  private guardarSesion(data: LoginData): void {
    const sesion: SesionLocal = {
      id: data.user.id,
      email: data.user.email,
      rol: data.user.rol ?? null,
    };

    try {
      localStorage.setItem(CLAVE_TOKEN, data.token);
      localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
    } catch {
      // Si no se puede persistir, la sesión dura lo que dure la pestaña.
    }

    this.sesionActual.set(sesion);
  }

  /**
   * Recupera la sesión guardada al arrancar la aplicación.
   * @returns La sesión, o null si no hay o está corrupta.
   */
  private leerSesion(): SesionLocal | null {
    try {
      if (!localStorage.getItem(CLAVE_TOKEN)) return null;

      const crudo = localStorage.getItem(CLAVE_SESION);
      if (!crudo) return null;

      const dato = JSON.parse(crudo) as SesionLocal;
      // Validamos la forma: el contenido de localStorage es manipulable.
      if (typeof dato?.id !== 'number' || typeof dato?.email !== 'string') {
        this.borrarAlmacenamiento();
        return null;
      }

      return { id: dato.id, email: dato.email, rol: dato.rol ?? null };
    } catch {
      this.borrarAlmacenamiento();
      return null;
    }
  }

  /** Elimina las claves de autenticación del navegador. */
  private borrarAlmacenamiento(): void {
    try {
      localStorage.removeItem(CLAVE_TOKEN);
      localStorage.removeItem(CLAVE_SESION);
    } catch {
      // Nada que hacer si el almacenamiento no está disponible.
    }
  }
}
