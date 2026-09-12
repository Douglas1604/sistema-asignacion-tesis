/**
 * @fileoverview Pruebas del interceptor de autenticación.
 *
 * Cubren lo que de verdad importa: que el token se adjunte a las peticiones de
 * nuestra API, que NO se adjunte a terceros (filtraría la credencial) y que un
 * 401 limpie la sesión.
 */

import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { authInterceptor } from './auth-interceptor';
import { AuthService } from '../services/auth';
import { environment } from '../../environments/environment';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  const TOKEN = 'token-de-prueba-123';

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', children: [] },
          { path: 'dashboard', children: [] },
          { path: 'reportes', children: [] },
        ]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('adjunta el token Bearer a las peticiones de la API', () => {
    localStorage.setItem('auth_token', TOKEN);

    http.get(`${environment.apiUrl}/asignaciones`).subscribe();

    const req = httpMock.expectOne(`${environment.apiUrl}/asignaciones`);
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    req.flush({ success: true, data: [] });
  });

  it('no adjunta cabecera cuando no hay sesión', () => {
    http.get(`${environment.apiUrl}/asignaciones`).subscribe();

    const req = httpMock.expectOne(`${environment.apiUrl}/asignaciones`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ success: true, data: [] });
  });

  it('nunca envía el token a un dominio ajeno', () => {
    localStorage.setItem('auth_token', TOKEN);

    const urlExterna = 'https://servidor-ajeno.example/recolectar';
    http.get(urlExterna).subscribe({ error: () => undefined });

    const req = httpMock.expectOne(urlExterna);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('no se deja engañar por una URL que contiene la de la API', () => {
    localStorage.setItem('auth_token', TOKEN);

    // El origen es ajeno aunque la cadena de la API aparezca en la query.
    const urlTrampa = `https://atacante.example/?next=${environment.apiUrl}/asignaciones`;
    http.get(urlTrampa).subscribe({ error: () => undefined });

    const req = httpMock.expectOne(urlTrampa);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('limpia la sesión cuando la API responde 401', () => {
    localStorage.setItem('auth_token', TOKEN);
    localStorage.setItem(
      'auth_session',
      JSON.stringify({ id: 1, email: 'a@umg.edu.gt', rol: 'admin' }),
    );

    const authService = TestBed.inject(AuthService);

    http.get(`${environment.apiUrl}/usuarios`).subscribe({
      error: () => undefined,
    });

    httpMock
      .expectOne(`${environment.apiUrl}/usuarios`)
      .flush(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Token inválido' } },
        { status: 401, statusText: 'Unauthorized' },
      );

    expect(authService.obtenerToken()).toBeNull();
    expect(localStorage.getItem('auth_session')).toBeNull();
  });
});
