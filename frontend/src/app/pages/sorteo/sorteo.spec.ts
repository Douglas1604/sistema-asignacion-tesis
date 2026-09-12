import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { SorteoComponent } from './sorteo';

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
});
