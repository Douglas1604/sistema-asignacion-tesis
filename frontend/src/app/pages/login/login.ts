/**
 * @fileoverview Controlador de la pantalla de Inicio de Sesión (Login).
 * Recolecta las credenciales, hace una comprobación previa de comodidad
 * y las envía al servicio de autenticación.
 */

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';

import { AuthService } from '../../services/auth';
import { interpretarError } from '../../core/api-error';

/**
 * Dominios institucionales aceptados.
 *
 * ATENCIÓN: esta lista es solo una ayuda de INTERFAZ, para avisar al usuario
 * antes de gastar una petición. NO es un control de seguridad: cualquiera
 * puede saltárselo llamando a la API directamente. Quien decide de verdad
 * quién entra es el backend, comprobando las credenciales contra la base de
 * datos. No añadas aquí reglas de autorización.
 */
const DOMINIOS_INSTITUCIONALES = ['@miumg.edu.gt', '@umg.edu.gt'];

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginComponent {
  // Variables vinculadas a los inputs del formulario en el HTML mediante ngModel
  email: string = '';
  password: string = '';

  // Variable para mostrar mensajes de advertencia si las credenciales fallan
  errorMessage: string = '';

  // Evita envíos repetidos mientras la petición está en curso
  cargando: boolean = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  /**
   * @description Se ejecuta al hacer clic en el botón de "Ingresar".
   * Valida el formato del correo, empaqueta las credenciales y consume el
   * endpoint de login del servidor.
   */
  onLogin() {
    this.errorMessage = '';

    // Validación básica de campos vacíos
    if (!this.email || !this.password) {
      this.errorMessage = 'Por favor ingresa correo y contraseña';
      return;
    }

    // =======================================================
    // AYUDA DE INTERFAZ: SOLO CORREOS INSTITUCIONALES UMG
    // Comprobación de conveniencia, no de seguridad (ver arriba).
    // =======================================================
    const correo = this.email.trim().toLowerCase();
    const esCorreoInstitucional = DOMINIOS_INSTITUCIONALES.some((dominio) =>
      correo.endsWith(dominio),
    );

    if (!esCorreoInstitucional) {
      this.errorMessage =
        'Acceso denegado. Solo se permiten correos institucionales (@miumg.edu.gt o @umg.edu.gt).';
      return; // Detenemos la ejecución aquí, no hacemos petición al backend
    }

    this.cargando = true;

    // La contraseña viaja en claro sobre el canal y es el servidor quien la
    // verifica contra el hash bcrypt. El cliente nunca la guarda ni la hashea.
    this.authService
      .login({ email: correo, password: this.password })
      .subscribe({
        next: () => {
          this.cargando = false;
          // Borramos la contraseña de memoria en cuanto deja de hacer falta.
          this.password = '';

          // Volvemos a donde el usuario quería ir, si la guarda lo desvió.
          const destino =
            this.route.snapshot.queryParamMap.get('redirigir') ?? '/dashboard';
          this.router.navigateByUrl(destino);
        },
        error: (err) => {
          this.cargando = false;
          this.password = '';

          const error = interpretarError(err);

          // Con credenciales incorrectas mostramos siempre el mismo aviso:
          // el servidor tampoco distingue entre correo inexistente y
          // contraseña equivocada, para no revelar qué cuentas existen.
          this.errorMessage =
            error.status === 401
              ? 'Correo o contraseña incorrectos'
              : error.mensaje;
        },
      });
  }
}
