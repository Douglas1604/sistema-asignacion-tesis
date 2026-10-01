import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { SorteoComponent, Alumno } from './sorteo';
import { AsignacionService } from '../../services/asignacion';

// Los diálogos no aportan nada a la lógica del sorteo y, con temporizadores
// falsos, sus animaciones bloquean el avance del reloj simulado.
vi.mock('sweetalert2', () => ({
  default: {
    fire: vi.fn(() => Promise.resolve({ isConfirmed: false, value: undefined })),
    close: vi.fn(),
    showValidationMessage: vi.fn(),
  },
}));

describe('SorteoComponent', () => {
  let component: SorteoComponent;
  let fixture: ComponentFixture<SorteoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SorteoComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SorteoComponent);
    component = fixture.componentInstance;
  });

  it('se crea correctamente', () => {
    expect(component).toBeTruthy();
  });

  it('conserva intacto el cálculo de cupos del sorteo normal', () => {
    // Salvaguarda: la matemática de reparto no debe cambiar con el refactor.
    component.profesoresNormal = [
      { nombre_completo: 'A' },
      { nombre_completo: 'B' },
      { nombre_completo: 'C' },
    ];
    component.alumnosNormal = Array.from({ length: 10 }, (_, i) => ({
      carnet: `c${i}`,
      nombre_completo: `A${i}`,
    }));

    component.calcularMatematicaNormal();

    // 10 alumnos entre 3 catedráticos: cupo base 3, sobrantes 1.
    expect(component.cupoBaseNormal).toBe(3);
    expect(component.sobrantesNormal).toBe(1);
  });

  it('conserva intacto el cálculo de ternas de tesis', () => {
    component.profesoresTesis = Array.from({ length: 9 }, (_, i) => ({
      nombre_completo: `P${i}`,
    }));
    component.alumnosTesis = Array.from({ length: 10 }, (_, i) => ({
      carnet: `c${i}`,
      nombre_completo: `A${i}`,
    }));

    component.calcularMatematicaTesis();

    // 9 catedráticos -> 3 ternas; 10 alumnos entre 3: cupo base 3, sobrantes 1.
    expect(component.cantidadTernasTesis).toBe(3);
    expect(component.cupoBaseTesis).toBe(3);
    expect(component.sobrantesTesis).toBe(1);
  });

  it('no divide entre cero si se fuerzan cero ternas', () => {
    component.alumnosTesis = [{ carnet: 'c1', nombre_completo: 'A1' }];
    component.profesoresTesis = [];

    component.calcularMatematicaTesis(0);

    expect(component.cantidadTernasTesis).toBe(1);
    expect(Number.isFinite(component.cupoBaseTesis)).toBe(true);
    expect(component.cupoBaseTesis).toBe(1);
    expect(component.sobrantesTesis).toBe(0);
  });

  // =========================================================================
  // REGRESIÓN: alumnos duplicados y huérfanos con "Jurado Designado"
  // =========================================================================
  describe('sorteo completo de tesis con jurado designado', () => {
    /** Alumnos enviados al backend en cada llamada de guardado. */
    let enviados: Alumno[][];

    beforeEach(() => {
      vi.useFakeTimers();

      enviados = [];
      const servicio = TestBed.inject(AsignacionService);
      vi.spyOn(servicio, 'guardarTernaTesis').mockImplementation(
        (_profesores, alumnos) => {
          enviados.push(alumnos as Alumno[]);
          return of({
            lote_id: `lote-${enviados.length}`,
            registros: alumnos.length * 3,
            tipo_evento_id: 3,
            modo: 'tesis' as const,
          });
        },
      );

      component.eventoSeleccionado = { id: 3, nombre: 'Tesis' };
      component.alumnosTesis = Array.from({ length: 9 }, (_, i) => ({
        id: i + 1,
        carnet: `carnet-${i + 1}`,
        nombre_completo: `Alumno ${i + 1}`,
      }));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** Sortea `cantidad` alumnos dejando correr la animación de cada giro. */
    const sortearAlumnos = (cantidad: number) => {
      for (let i = 0; i < cantidad; i++) {
        component.iniciarSorteoTesisAlumnoIndividual();
        // La duración es la misma que la transición CSS de la ruleta.
        vi.advanceTimersByTime(4000);
      }
    };

    it('reparte los 9 alumnos en 3 ternas sin repetidos y sin dejar huérfanos', () => {
      for (let terna = 1; terna <= 3; terna++) {
        component.fijarJuradoDesignado([
          `Presidente ${terna}`,
          `Vocal1 ${terna}`,
          `Vocal2 ${terna}`,
        ]);

        // 9 alumnos entre 3 ternas: 3 por terna, sin sobrantes.
        expect(component.cupoActualTesis).toBe(3);

        sortearAlumnos(component.cupoActualTesis);
        component.guardarTesisOficial();
      }

      const carnetsEnviados = enviados.flat().map((a) => a.carnet);

      // 1) Nadie repetido. Antes, el último alumno de cada terna seguía en la
      //    ruleta y volvía a salir en la siguiente.
      expect(new Set(carnetsEnviados).size).toBe(carnetsEnviados.length);

      // 2) Nadie sin asignar. El síntoma reportado eran exactamente 2
      //    huérfanos: uno por cada transición de terna (1->2 y 2->3).
      expect(carnetsEnviados.length).toBe(9);
      expect(component.alumnosTesis.length).toBe(0);

      // 3) Los tres grupos guardados tienen el tamaño previsto.
      expect(enviados.map((grupo) => grupo.length)).toEqual([3, 3, 3]);
    });

    it('retira al alumno de la ruleta en cuanto se cierra su terna', () => {
      component.fijarJuradoDesignado(['P', 'V1', 'V2']);
      sortearAlumnos(component.cupoActualTesis);

      const asignados = component.alumnosTesisAsignados.map((a) => a.carnet);
      component.guardarTesisOficial();

      const restantes = component.alumnosTesis.map((a) => a.carnet);
      for (const carnet of asignados) {
        expect(restantes).not.toContain(carnet);
      }
      expect(restantes.length).toBe(6);
    });

    it('tampoco los devuelve a la ruleta si el guardado falla', () => {
      const servicio = TestBed.inject(AsignacionService);
      vi.spyOn(servicio, 'guardarTernaTesis').mockReturnValue(
        throwError(() => new Error('sin red')),
      );

      component.fijarJuradoDesignado(['P', 'V1', 'V2']);
      sortearAlumnos(component.cupoActualTesis);
      const asignados = component.alumnosTesisAsignados.map((a) => a.carnet);

      component.guardarTesisOficial();

      // La terna sigue en pantalla para reintentar, pero sus alumnos ya no
      // pueden volver a salir en otro giro.
      expect(component.alumnosTesisAsignados.length).toBe(3);
      expect(component.guardandoTesis).toBe(false);
      for (const carnet of asignados) {
        expect(component.alumnosTesis.map((a) => a.carnet)).not.toContain(carnet);
      }
    });

    it('ignora un segundo clic en guardar mientras la petición está en curso', () => {
      const servicio = TestBed.inject(AsignacionService);
      const espia = vi.spyOn(servicio, 'guardarTernaTesis');

      component.fijarJuradoDesignado(['P', 'V1', 'V2']);
      sortearAlumnos(component.cupoActualTesis);

      component.guardarTesisOficial();
      component.guardarTesisOficial();

      // El doble envío habría registrado la misma terna en dos lotes.
      expect(espia).toHaveBeenCalledTimes(1);
    });

    it('no envía una terna vacía cuando el cupo calculado es cero', () => {
      const servicio = TestBed.inject(AsignacionService);
      const espia = vi.spyOn(servicio, 'guardarTernaTesis');

      component.catedraticosTesisAsignados = [
        { nombre_completo: 'P' },
        { nombre_completo: 'V1' },
        { nombre_completo: 'V2' },
      ];
      component.alumnosTesisAsignados = [];
      component.cupoActualTesis = 0;

      component.guardarTesisOficial();

      expect(espia).not.toHaveBeenCalled();
    });
  });
});
