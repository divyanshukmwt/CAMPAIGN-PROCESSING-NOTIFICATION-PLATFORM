# Task Management System

A full-stack task management application built with **Angular**, **Laravel** and **MySQL** using a clean three-tier architecture. Users can create, view, search, update and delete their tasks, organised by status and priority, through a secure REST API.

> **Project status:** under active development. Sections marked *(coming soon)* describe functionality that is planned but not yet available.

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
- **Security hardening** — explicit CORS origins, rate limiting, centralised JSON error handling.

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
├── task-management-ui/    # Angular application       (coming soon)
├── e2e/                   # End-to-end tests          (coming soon)
└── docs/                  # Postman collection, deployment examples (coming soon)
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
php artisan serve --host=localhost --port=8000
```

Verify the API is running: <http://localhost:8000/api/health>

```json
{ "status": "ok", "service": "Task Management API", "database": "connected", "timestamp": "..." }
```

### 3. Frontend (Angular)

*(coming soon)*

## Configuration

Backend settings live in `task-management-api/.env` (never commit this file):

| Variable | Description | Default |
|---|---|---|
| `APP_URL` | Public URL of the API | `http://localhost:8000` |
| `DB_HOST` / `DB_PORT` | MySQL server | `127.0.0.1` / `3306` |
| `DB_DATABASE` | Application database | `task_management` |
| `DB_USERNAME` / `DB_PASSWORD` | MySQL credentials | — |
| `CORS_ALLOWED_ORIGINS` | Comma-separated trusted frontend origins | `http://localhost:4200` |

> Use `localhost` (not `127.0.0.1`) in the browser for both applications so cookie-based authentication works.

## Usage

*(coming soon)*

## API reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | API and database health check |
| GET | `/api/tasks` | List tasks (optional `?search=`) *(coming soon)* |
| GET | `/api/tasks/{id}` | Get a task *(coming soon)* |
| POST | `/api/tasks` | Create a task *(coming soon)* |
| PUT | `/api/tasks/{id}` | Update a task *(coming soon)* |
| DELETE | `/api/tasks/{id}` | Delete a task *(coming soon)* |

## Testing

Backend tests run against the dedicated `task_management_test` MySQL database:

```bash
cd task-management-api
php artisan test
```

## License

This project is provided for educational and portfolio purposes.
