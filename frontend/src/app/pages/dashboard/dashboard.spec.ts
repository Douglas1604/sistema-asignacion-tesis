import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { DashboardComponent } from './dashboard';
import { environment } from '../../../environments/environment';

const swalMock = vi.hoisted(() => ({
  fire: vi.fn(() => Promise.resolve({ isConfirmed: true, value: undefined })),
  close: vi.fn(),
}));

vi.mock('sweetalert2', () => ({ default: swalMock }));

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let httpMock: HttpTestingController;

  /** Una tesista con su jurado de tres: la API devuelve una fila por miembro. */
  const HISTORIAL = {
    success: true,
    data: [
      {
        lote_id: 'aaaa1111-1111-4111-8111-111111111111',
        modalidad: 'Tesis',
        profesor_nombre: 'Ing. Uno (Presidente)',
        alumno_info: '1990-12-3456 - Ana López',
        fecha: '12/09/2026 10:30',
      },
      {
        lote_id: 'aaaa1111-1111-4111-8111-111111111111',
        modalidad: 'Tesis',
        profesor_nombre: 'Ing. Dos (Vocal 1)',
        alumno_info: '1990-12-3456 - Ana López',
        fecha: '12/09/2026 10:30',
      },
      {
        lote_id: 'aaaa1111-1111-4111-8111-111111111111',
        modalidad: 'Tesis',
        profesor_nombre: 'Ing. Tres (Vocal 2)',
        alumno_info: '1990-12-3456 - Ana López',
        fecha: '12/09/2026 10:30',
      },
    ],
  };

  beforeEach(async () => {
    swalMock.fire.mockClear();

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('se crea correctamente', () => {
    expect(component).toBeTruthy();
  });

  it('traduce el historial de la API a los campos que pinta la tabla', () => {
    component.cargarDatos();
    httpMock.expectOne(`${environment.apiUrl}/asignaciones`).flush(HISTORIAL);

    // La plantilla leía `alumno_carnet`, `alumno_nombre` y `fecha_formateada`,
    // que la API no devuelve: la tabla salía con las celdas en blanco.
    expect(component.ultimosSorteos.length).toBe(1);
    const fila = component.ultimosSorteos[0];
    expect(fila.alumno_carnet).toBe('1990-12-3456');
    expect(fila.alumno_nombre).toBe('Ana López');
    expect(fila.fecha_formateada).toBe('12/09/2026 10:30');
    expect(fila.profesores).toContain('Presidente');
    expect(fila.profesores).toContain('Vocal 2');

    // Y los totales cuentan asignaciones, no filas de la base de datos.
    expect(component.totalSorteos).toBe(1);
    expect(component.totalTesis).toBe(1);
  });

  it('elimina por lote y carnet, no por fecha', async () => {
    component.cargarDatos();
    httpMock.expectOne(`${environment.apiUrl}/asignaciones`).flush(HISTORIAL);

    component.eliminarSorteo(component.ultimosSorteos[0]);
    await Promise.resolve();
    await Promise.resolve();

    const peticion = httpMock.expectOne(
      `${environment.apiUrl}/asignaciones/lote/aaaa1111-1111-4111-8111-111111111111/alumno/1990-12-3456`,
    );
    expect(peticion.request.method).toBe('DELETE');
    peticion.flush({ success: true, data: { eliminados: 3 } });

    httpMock
      .expectOne(`${environment.apiUrl}/asignaciones`)
      .flush({ success: true, data: [] });
    expect(component.ultimosSorteos.length).toBe(0);
  });
});
