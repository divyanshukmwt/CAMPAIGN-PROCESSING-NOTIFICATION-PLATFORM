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
├── task-management-api/   # Laravel REST API          (coming soon)
├── task-management-ui/    # Angular application       (coming soon)
├── e2e/                   # End-to-end tests          (coming soon)
└── docs/                  # Postman collection, deployment examples (coming soon)
```

## Prerequisites

| Software | Version |
|---|---|
| PHP | 8.3 or newer (extensions: `pdo_mysql`, `mbstring`, `openssl`, `fileinfo`, `curl`, `zip`) |
| Composer | 2.x |
| Node.js | 20.19+ / 22.x LTS |
| npm | 10+ |
| Angular CLI | latest stable |
| MySQL Server | 8.0 |

## Installation

*(coming soon — full setup instructions will be added as the backend and frontend are delivered.)*

## Configuration

*(coming soon)*

## Usage

*(coming soon)*

## API reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/tasks` | List tasks (optional `?search=`) |
| GET | `/api/tasks/{id}` | Get a task |
| POST | `/api/tasks` | Create a task |
| PUT | `/api/tasks/{id}` | Update a task |
| DELETE | `/api/tasks/{id}` | Delete a task |

## Testing

*(coming soon)*

## License

This project is provided for educational and portfolio purposes.
