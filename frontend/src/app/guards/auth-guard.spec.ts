/**
 * @fileoverview Pruebas de la guarda de rutas.
 * Comprueban que una ruta protegida no se abre sin sesión y que sí se abre con
 * ella. Recordatorio: esto valida el comportamiento de la interfaz, no la
 * seguridad real, que la impone el backend.
 */

import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { authGuard } from './auth-guard';
import { AuthService } from '../services/auth';

describe('authGuard', () => {
  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => localStorage.clear());

  /**
   * Ejecuta la guarda dentro del contexto de inyección de Angular.
   * @param url Ruta solicitada.
   */
  function ejecutarGuarda(url = '/dashboard') {
    return TestBed.runInInjectionContext(() =>
      authGuard({} as any, { url } as any),
    );
  }

  it('bloquea el acceso cuando no hay sesión', () => {
    const resultado = ejecutarGuarda('/dashboard');

    // Devuelve un UrlTree de redirección, no `true`.
    expect(resultado).toBeInstanceOf(UrlTree);
  });

  it('redirige al login conservando el destino solicitado', () => {
    const router = TestBed.inject(Router);
    const resultado = ejecutarGuarda('/reportes') as UrlTree;

    const destino = router.serializeUrl(resultado);
    expect(destino).toContain('/login');
    expect(destino).toContain('redirigir');
  });

  it('permite el acceso cuando hay un token guardado', () => {
    localStorage.setItem('auth_token', 'token-de-prueba');

    expect(ejecutarGuarda('/dashboard')).toBe(true);
  });

  it('bloquea de nuevo tras cerrar sesión', () => {
    localStorage.setItem('auth_token', 'token-de-prueba');
    expect(ejecutarGuarda()).toBe(true);

    TestBed.inject(AuthService).logout();

    expect(ejecutarGuarda()).toBeInstanceOf(UrlTree);
  });
});
