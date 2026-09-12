/**
 * @deprecated Contrato de la versión anterior del login, sin token JWT.
 * No se importa en ningún archivo; el contrato vigente es `LoginData`
 * dentro de `ApiResponse`, definido en `models/api.ts`.
 */
export interface LoginResponse {
  success: boolean;
  message: string;
  user: {
    id: number;
    email: string;
    username?: string; // El ? significa opcional
  };
}