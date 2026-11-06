export interface Environment {
  production: boolean;
  apiUrl: string;
  baseUrl: string;
}

export const environment: Environment = {
  production: true,
  apiUrl: 'http://localhost:8000/api',
  baseUrl: 'http://localhost:8000',
};
