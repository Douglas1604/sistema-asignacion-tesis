export interface LoginResponse {
  success: boolean;
  message: string;
  user: {
    id: number;
    email: string;
    username?: string; // El ? significa opcional
  };
}