/**
 * @fileoverview Pruebas del servicio de autenticación:
 * login correcto, login fallido, cierre de sesión y qué se guarda realmente
 * en el navegador.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { AuthService } from './auth';
import { environment } from '../../environments/environment';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  const RESPUESTA_LOGIN = {
    success: true,
    data: {
      token: 'jwt-de-prueba',
      expiresIn: '8h',
      user: {
        id: 1,
        username: 'Admin',
        email: 'admin@umg.edu.gt',
        rol_id: 1,
        rol: 'admin',
        creado_en: '2026-02-18 05:31:03',
      },
    },
  };

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('se crea correctamente', () => {
    expect(service).toBeTruthy();
  });

  it('envía las credenciales al endpoint correcto con el campo password', () => {
    service.login({ email: 'admin@umg.edu.gt', password: 'secreta' }).subscribe();

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.password).toBe('secreta');
    // El contrato del cliente usa `password`, nunca `password_hash`.
    expect(req.request.body.password_hash).toBeUndefined();

    req.flush(RESPUESTA_LOGIN);
  });

  it('un login correcto guarda el token y marca la sesión como activa', () => {
    let recibido: string | undefined;

    service
      .login({ email: 'admin@umg.edu.gt', password: 'secreta' })
      .subscribe((data) => (recibido = data.token));

    httpMock.expectOne(`${environment.apiUrl}/auth/login`).flush(RESPUESTA_LOGIN);

    expect(recibido).toBe('jwt-de-prueba');
    expect(service.obtenerToken()).toBe('jwt-de-prueba');
    expect(service.estaAutenticado()).toBe(true);
    expect(service.obtenerSesion()?.email).toBe('admin@umg.edu.gt');
  });

  it('nunca guarda la contraseña en el almacenamiento del navegador', () => {
    service.login({ email: 'admin@umg.edu.gt', password: 'MiClaveSecreta' }).subscribe();

    httpMock.expectOne(`${environment.apiUrl}/auth/login`).flush(RESPUESTA_LOGIN);

    const todo = JSON.stringify(localStorage);
    expect(todo).not.toContain('MiClaveSecreta');
    expect(todo).not.toContain('password');
    expect(todo).not.toContain('password_hash');
  });

  it('guarda solo la identidad mínima, sin el perfil completo', () => {
    service.login({ email: 'admin@umg.edu.gt', password: 'secreta' }).subscribe();

    httpMock.expectOne(`${environment.apiUrl}/auth/login`).flush(RESPUESTA_LOGIN);

    const sesion = JSON.parse(localStorage.getItem('auth_session') ?? '{}');
    expect(Object.keys(sesion).sort()).toEqual(['email', 'id', 'rol']);
    // Campos que no necesita la interfaz no se persisten.
    expect(sesion.username).toBeUndefined();
    expect(sesion.creado_en).toBeUndefined();
  });

  it('un login fallido no crea ninguna sesión', () => {
    let fallo = false;

    service
      .login({ email: 'admin@umg.edu.gt', password: 'incorrecta' })
      .subscribe({ error: () => (fallo = true) });

    httpMock
      .expectOne(`${environment.apiUrl}/auth/login`)
      .flush(
        {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Correo o contraseña incorrectos' },
        },
        { status: 401, statusText: 'Unauthorized' },
      );

    expect(fallo).toBe(true);
    expect(service.obtenerToken()).toBeNull();
    expect(service.estaAutenticado()).toBe(false);
  });

  it('el cierre de sesión borra todo el estado de autenticación', () => {
    service.login({ email: 'admin@umg.edu.gt', password: 'secreta' }).subscribe();
    httpMock.expectOne(`${environment.apiUrl}/auth/login`).flush(RESPUESTA_LOGIN);

    expect(service.estaAutenticado()).toBe(true);

    service.logout();

    expect(service.obtenerToken()).toBeNull();
    expect(service.obtenerSesion()).toBeNull();
    expect(service.estaAutenticado()).toBe(false);
    expect(localStorage.getItem('auth_session')).toBeNull();
  });

  it('descarta una sesión corrupta en el almacenamiento', () => {
    localStorage.setItem('auth_token', 'algo');
    localStorage.setItem('auth_session', '{ esto no es json');

    // Instancia nueva: relee el almacenamiento al construirse.
    const otro = new AuthService({} as any);
    expect(otro.obtenerSesion()).toBeNull();
  });
});
