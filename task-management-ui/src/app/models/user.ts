export type UserRole = 'admin' | 'user';

export interface User {
  id: number;
  name: string;
  email: string;
  roles?: UserRole[];
  active_role?: UserRole;
  created_at?: string;
  updated_at?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
  role?: UserRole;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  role?: UserRole;
  dual_role?: boolean;
}

export interface AuthResponse {
  message: string;
  user: User;
  tab_token?: string | null;
}

export interface LogoutResponse {
  message: string;
}
