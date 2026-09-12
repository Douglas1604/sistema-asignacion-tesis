/**
 * @fileoverview Pruebas de la pantalla de login: éxito, fallo, validaciones
 * previas y tratamiento de la contraseña en memoria.
 */

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';

import { LoginComponent } from './login';
import { environment } from '../../../environments/environment';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let httpMock: HttpTestingController;

  const RESPUESTA_OK = {
    success: true,
    data: {
      token: 'jwt-de-prueba',
      expiresIn: '8h',
      user: { id: 1, email: 'admin@umg.edu.gt', rol: 'admin' },
    },
  };

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([
          { path: 'login', children: [] },
          { path: 'dashboard', children: [] },
          { path: 'reportes', children: [] },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('se crea correctamente', () => {
    expect(component).toBeTruthy();
  });

  it('exige correo y contraseña antes de llamar al servidor', () => {
    component.email = '';
    component.password = '';
    component.onLogin();

    expect(component.errorMessage).toContain('correo y contraseña');
    httpMock.expectNone(`${environment.apiUrl}/auth/login`);
  });

  it('avisa si el correo no es institucional y no gasta una petición', () => {
    component.email = 'alguien@gmail.com';
    component.password = 'secreta';
    component.onLogin();

    expect(component.errorMessage).toContain('institucionales');
    httpMock.expectNone(`${environment.apiUrl}/auth/login`);
  });

  it('un login correcto navega al dashboard', () => {
    const router = TestBed.inject(Router);
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    component.email = 'admin@umg.edu.gt';
    component.password = 'secreta';
    component.onLogin();

    httpMock.expectOne(`${environment.apiUrl}/auth/login`).flush(RESPUESTA_OK);

    expect(navegar).toHaveBeenCalledWith('/dashboard');
    expect(component.errorMessage).toBe('');
  });

  it('borra la contraseña de memoria tras el intento', () => {
    component.email = 'admin@umg.edu.gt';
    component.password = 'MiClaveSecreta';
    component.onLogin();

    httpMock.expectOne(`${environment.apiUrl}/auth/login`).flush(RESPUESTA_OK);

    expect(component.password).toBe('');
  });

  it('muestra un aviso genérico si las credenciales son incorrectas', () => {
    component.email = 'admin@umg.edu.gt';
    component.password = 'incorrecta';
    component.onLogin();

    httpMock.expectOne(`${environment.apiUrl}/auth/login`).flush(
      {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Correo o contraseña incorrectos' },
      },
      { status: 401, statusText: 'Unauthorized' },
    );

    expect(component.errorMessage).toBe('Correo o contraseña incorrectos');
    expect(component.cargando).toBe(false);
    expect(component.password).toBe('');
  });

  it('informa cuando el servidor no está disponible', () => {
    component.email = 'admin@umg.edu.gt';
    component.password = 'secreta';
    component.onLogin();

    httpMock
      .expectOne(`${environment.apiUrl}/auth/login`)
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(component.errorMessage).toBeTruthy();
    // No se filtra el detalle interno del servidor.
    expect(component.errorMessage).not.toContain('Server Error');
  });
});
