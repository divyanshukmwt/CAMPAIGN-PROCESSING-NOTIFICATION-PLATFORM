# Task Management System

A full-stack task management application built with **Angular**, **Laravel** and **MySQL** using a clean three-tier architecture. Users can create, view, search, update and delete their tasks, organised by status and priority, through a secure REST API.

---

## Features

- **Task CRUD** — create, list, view, edit and delete tasks.
- **Search** — find tasks by title.
- **Status tracking** — Pending, In Progress, Completed.
- **Priorities** — Low, Medium, High.
- **Due dates** — optional target completion date.
- **Validation** — client-side and server-side validation with clear error messages.
- **Authentication** — secure login/registration with Laravel Sanctum (cookie-based SPA authentication).
- **Authorisation** — every user sees and manages only their own tasks.
- **Responsive UI** — Angular Material interface with loading, empty and error states.
- **Security hardening** — explicit CORS origins, rate limiting (API, login, registration), security audit logging, centralised JSON error handling.

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | Angular (standalone components), TypeScript, Angular Material, SCSS, RxJS |
| Backend | PHP 8.3+, Laravel, Laravel Sanctum |
| Database | MySQL 8.0 |
| Testing | PHPUnit, Angular unit tests, Playwright (E2E), Postman |

## Architecture

```
Angular SPA (localhost:4200)
        │  HTTP / JSON
        ▼
Laravel REST API (localhost:8000)
  Route → Middleware → Form Request → Controller → Service → Repository → Eloquent
        │
        ▼
MySQL (task_management)
```

## Repository structure

```
.
├── task-management-api/   # Laravel REST API
├── task-management-ui/    # Angular application
├── e2e/                   # Playwright end-to-end tests
└── docs/                  # Postman collection & deployment examples
```

## Prerequisites

| Software | Version |
|---|---|
| PHP | 8.3 or newer (8.4 recommended; extensions: `pdo_mysql`, `mbstring`, `openssl`, `fileinfo`, `curl`, `zip`, `intl`) |
| Composer | 2.x |
| Node.js | 20.19+ / 22.x LTS |
| npm | 10+ |
| Angular CLI | latest stable |
| MySQL Server | 8.0 |

## Installation

### 1. Create the databases

```sql
CREATE DATABASE task_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE task_management_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Backend (Laravel API)

```bash
cd task-management-api
composer install
cp .env.example .env          # Windows: copy .env.example .env
php artisan key:generate
# edit .env and set DB_USERNAME / DB_PASSWORD
php artisan migrate
php artisan db:seed            # optional: demo user + sample tasks
php artisan serve --host=localhost --port=8000
```

Verify the API is running: <http://localhost:8000/api/health>

```json
{ "status": "ok", "service": "Task Management API", "database": "connected", "timestamp": "..." }
```

**Demo account** (created by `php artisan db:seed`, local development only): `test@example.com` / `Password123`.

### 3. Frontend (Angular)

```bash
cd task-management-ui
npm install
npm start
```

Open <http://localhost:4200> in your browser. Sign in with the demo account (`test@example.com` / `Password123`) or register a new account.

## Configuration

Backend settings live in `task-management-api/.env` (never commit this file):

| Variable | Description | Default |
|---|---|---|
| `APP_URL` | Public URL of the API | `http://localhost:8000` |
| `DB_HOST` / `DB_PORT` | MySQL server | `127.0.0.1` / `3306` |
| `DB_DATABASE` | Application database | `task_management` |
| `DB_USERNAME` / `DB_PASSWORD` | MySQL credentials | — |
| `CORS_ALLOWED_ORIGINS` | Comma-separated trusted frontend origins | `http://localhost:4200` |
| `SANCTUM_STATEFUL_DOMAINS` | Hosts (with port) that use cookie-based SPA authentication | `localhost:4200,localhost:8000,localhost` |
| `SESSION_DRIVER` / `SESSION_LIFETIME` | Session storage and lifetime (minutes) | `database` / `120` |
| `RATE_LIMIT_API` | API requests per minute per user (or IP for guests) | `60` |
| `RATE_LIMIT_LOGIN` | Login attempts per minute per email + IP | `5` |
| `RATE_LIMIT_REGISTER` | Registrations per minute per IP | `10` |

### Logging

| Log file | Contents |
|---|---|
| `storage/logs/laravel.log` | Application log (task create/update/delete events, errors) |
| `storage/logs/security-YYYY-MM-DD.log` | Security audit log: logins, failed logins (masked email), logouts, registrations, rate-limit violations — kept 30 days, never contains passwords |

> Use `localhost` (not `127.0.0.1`) in the browser for both applications so cookie-based authentication works.

## Usage

1. Start the Laravel API on `http://localhost:8000` and the Angular application on `http://localhost:4200`.
2. Navigate to `http://localhost:4200/login` (or `/register` to create a new account).
3. From the **Tasks** view (`/tasks`), search tasks by title, create new tasks (`/tasks/new`), inspect full task details (`/tasks/:id`), edit existing tasks (`/tasks/:id/edit`), or delete tasks with a confirmation dialog.

## API reference

Base URL: `http://localhost:8000/api` — send `Accept: application/json`.

### Authentication

The API uses **Laravel Sanctum cookie-based SPA authentication** (HttpOnly session cookie + CSRF token). No tokens are stored in the browser's local storage.

1. `GET /sanctum/csrf-cookie` — sets the `XSRF-TOKEN` cookie.
2. Send the cookie value back in the `X-XSRF-TOKEN` header on every `POST`/`PUT`/`PATCH`/`DELETE` request, with credentials (cookies) included.
3. `POST /api/login` or `POST /api/register` — starts a session.

| Method | Endpoint | Description | Success |
|---|---|---|---|
| POST | `/register` | Register (`name`, `email`, `password`, `password_confirmation`, optional `role`, `dual_role`) and log in | `201` |
| POST | `/login` | Log in (`email`, `password`, optional `role`: `admin` \| `user`, `remember`) | `200` |
| POST | `/auth/switch-role` | Switch active role (`role`: `admin` \| `user`) for dual-role accounts | `200` |
| POST | `/logout` | Log out (authenticated) | `200` |
| GET | `/user` | Current user with `roles` and `active_role` (authenticated) | `200` |

Passwords must be at least 8 characters and contain letters and numbers.

### Tasks

All task endpoints require authentication. Each user only sees and manages **their own** tasks.

| Method | Endpoint | Description | Success |
|---|---|---|---|
| GET | `/health` | API and database health check (public) | `200` |
| GET | `/tasks` | List tasks, newest first (optional `?search=` by title) | `200` array |
| GET | `/tasks/{id}` | Get a task | `200` object |
| POST | `/tasks` | Create a task | `201` |
| PUT / PATCH | `/tasks/{id}` | Update a task (partial updates allowed) | `200` |
| DELETE | `/tasks/{id}` | Delete a task | `200` |

### Task fields

| Field | Type | Rules |
|---|---|---|
| `title` | string | required, max 255 |
| `description` | string \| null | optional |
| `status` | string | `Pending`, `In Progress`, `Completed` (default `Pending`) |
| `priority` | string | `Low`, `Medium`, `High` (default `Medium`) |
| `due_date` | `YYYY-MM-DD` \| null | optional, valid date |

### Example — create a task

```http
POST /api/tasks
Content-Type: application/json

{
  "title": "Learn Laravel",
  "description": "Understand Laravel API development",
  "status": "Pending",
  "priority": "High",
  "due_date": "2026-12-31"
}
```

```json
{
  "message": "Task created successfully",
  "data": {
    "id": 1,
    "title": "Learn Laravel",
    "description": "Understand Laravel API development",
    "status": "Pending",
    "priority": "High",
    "due_date": "2026-12-31",
    "created_at": "2026-11-06T18:53:17+00:00",
    "updated_at": "2026-11-06T18:53:17+00:00"
  }
}
```

### Errors

All errors are JSON:

| Status | When | Body |
|---|---|---|
| `401` | Not logged in | `{ "message": "Unauthenticated." }` |
| `403` | Task belongs to another user | `{ "message": "This action is unauthorized." }` |
| `404` | Task or route not found | `{ "message": "Task not found." }` |
| `405` | Wrong HTTP method | `{ "message": "..." }` |
| `419` | Missing or invalid CSRF token | `{ "message": "CSRF token mismatch." }` |
| `422` | Validation failed / invalid credentials | `{ "message": "...", "errors": { "title": ["..."] } }` |
| `429` | Rate limit exceeded (see `Retry-After` header) | `{ "message": "Too many login attempts. Please try again later." }` |
| `500` | Unexpected error | `{ "message": "An unexpected error occurred. Please try again later." }` |

### Postman

Import [`docs/postman/TaskManagement.postman_collection.json`](docs/postman/TaskManagement.postman_collection.json) into Postman and run the collection in order. It fetches the CSRF cookie, registers a fresh user, exercises every task endpoint with test assertions, and finally logs out. It can also be run from the command line:

```bash
npx newman run docs/postman/TaskManagement.postman_collection.json
```

## Testing

Backend tests run against the dedicated `task_management_test` MySQL database:

```bash
cd task-management-api
php artisan test
```

Frontend unit tests run with the Angular CLI test runner:

```bash
cd task-management-ui
npm test -- --watch=false
```

End-to-end (E2E) integration tests run with Playwright against both running servers (`localhost:8000` and `localhost:4200`):

```bash
cd e2e
npm install
npx playwright test
```

## Production Deployment

Production deployment examples and hardening checklists are provided in [`docs/deployment/`](docs/deployment/):

- [`docs/deployment/mysql-least-privilege.sql`](docs/deployment/mysql-least-privilege.sql) — creates the `task_management` database and a dedicated least-privilege MySQL user (`SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES`).
- [`docs/deployment/nginx.conf.example`](docs/deployment/nginx.conf.example) — HTTPS Nginx reverse-proxy configuration serving the Angular production bundle (`ng build --configuration production`) and forwarding `/api` and `/sanctum` to PHP-FPM.

### Production checklist

1. Set `APP_ENV=production` and `APP_DEBUG=false` in `task-management-api/.env`.
2. Provision MySQL with [`docs/deployment/mysql-least-privilege.sql`](docs/deployment/mysql-least-privilege.sql) and run `php artisan migrate --force`.
3. Cache Laravel configuration, routes and views:
   ```bash
   php artisan config:cache
   php artisan route:cache
   php artisan view:cache
   ```
4. Build the Angular production bundle:
   ```bash
   cd task-management-ui
   npx ng build --configuration production
   ```

## License

This project is provided for educational and portfolio purposes.
