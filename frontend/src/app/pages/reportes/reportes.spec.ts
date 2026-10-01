import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { ReportesComponent } from './reportes';
import { environment } from '../../../environments/environment';

// Los diálogos de confirmación se sustituyen por un doble que acepta siempre:
// lo que se verifica aquí es la petición que sale, no el aspecto del modal.
const swalMock = vi.hoisted(() => ({
  fire: vi.fn(() => Promise.resolve({ isConfirmed: true, value: undefined })),
  close: vi.fn(),
}));

vi.mock('sweetalert2', () => ({ default: swalMock }));

describe('ReportesComponent', () => {
  let component: ReportesComponent;
  let fixture: ComponentFixture<ReportesComponent>;
  let httpMock: HttpTestingController;

  /** Historial plano tal y como lo devuelve la API. */
  const HISTORIAL = {
    success: true,
    data: [
      {
        lote_id: '11111111-1111-4111-8111-111111111111',
        modalidad: 'Tesis',
        profesor_nombre: 'Ing. Uno (Presidente)',
        alumno_info: '1990-1 - Ana',
        fecha: '12/09/2026 10:30',
      },
      {
        lote_id: '11111111-1111-4111-8111-111111111111',
        modalidad: 'Tesis',
        profesor_nombre: 'Ing. Dos (Vocal 1)',
        alumno_info: '1990-1 - Ana',
        fecha: '12/09/2026 10:30',
      },
      // Mismo minuto y misma modalidad, pero OTRO sorteo: antes se fusionaba
      // con el anterior porque la clave de agrupamiento era "modalidad + fecha".
      {
        lote_id: '22222222-2222-4222-8222-222222222222',
        modalidad: 'Tesis',
        profesor_nombre: 'Ing. Tres (Presidente)',
        alumno_info: '1990-2 - Luis',
        fecha: '12/09/2026 10:30',
      },
    ],
  };

  beforeEach(async () => {
    swalMock.fire.mockClear();

    await TestBed.configureTestingModule({
      imports: [ReportesComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportesComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('se crea correctamente', () => {
    expect(component).toBeTruthy();
  });

  it('agrupa por lote y no por fecha, aunque coincida el minuto', () => {
    component.cargarDatos();
    httpMock.expectOne(`${environment.apiUrl}/asignaciones`).flush(HISTORIAL);

    expect(component.sorteosAgrupados.length).toBe(2);
    expect(component.sorteosAgrupados[0].lote_id).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    // El primer lote reúne a sus dos catedráticos bajo un solo alumno.
    expect(component.sorteosAgrupados[0].profesores.size).toBe(2);
    expect(component.sorteosAgrupados[0].alumnos.size).toBe(1);
  });

  it('elimina el lote llamando a la ruta con su UUID', async () => {
    component.cargarDatos();
    httpMock.expectOne(`${environment.apiUrl}/asignaciones`).flush(HISTORIAL);

    component.eliminarSorteoBatch(component.sorteosAgrupados[0]);
    // La confirmación del diálogo resuelve en una microtarea.
    await Promise.resolve();
    await Promise.resolve();

    // Antes se pedía `/asignaciones/lote?fecha=12/09/2026 10:30`, que no
    // corresponde a ninguna ruta: el servidor respondía 404 y el botón rojo
    // parecía no hacer nada.
    const peticion = httpMock.expectOne(
      `${environment.apiUrl}/asignaciones/lote/11111111-1111-4111-8111-111111111111`,
    );
    expect(peticion.request.method).toBe('DELETE');
    peticion.flush({ success: true, data: { eliminados: 2 } });

    // Tras eliminar se recarga el listado.
    httpMock.expectOne(`${environment.apiUrl}/asignaciones`).flush({
      success: true,
      data: [],
    });
    expect(component.sorteosAgrupados.length).toBe(0);
    expect(component.eliminandoLoteId).toBeNull();
  });

  it('no intenta eliminar un histórico sin lote', async () => {
    component.cargarDatos();
    httpMock.expectOne(`${environment.apiUrl}/asignaciones`).flush({
      success: true,
      data: [
        {
          lote_id: '',
          modalidad: 'Privado',
          profesor_nombre: 'Grupo 1 - Ing. Cuatro',
          alumno_info: '1990-3 - Marta',
          fecha: '01/01/2026 08:00',
        },
      ],
    });

    component.eliminarSorteoBatch(component.sorteosAgrupados[0]);
    await Promise.resolve();

    httpMock.expectNone(() => true);
  });

  afterEach(() => {
    httpMock.verify();
  });
});
