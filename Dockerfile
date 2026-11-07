# ==============================================================================
# Stage 1: Build the Angular production bundle (task-management-ui)
# ==============================================================================
FROM node:22-alpine AS ui-build

WORKDIR /app/ui

COPY task-management-ui/package*.json ./
RUN npm ci

COPY task-management-ui/ ./

# Point production API & Sanctum requests to same-origin relative paths (/api & /)
RUN printf "export interface Environment {\n  production: boolean;\n  apiUrl: string;\n  baseUrl: string;\n}\n\nexport const environment: Environment = {\n  production: true,\n  apiUrl: '/api',\n  baseUrl: '',\n};\n" > src/environments/environment.ts

RUN npm run build

# ==============================================================================
# Stage 2: Laravel API + Built Angular SPA (task-management-api)
# ==============================================================================
FROM php:8.4-cli

# Install system dependencies and required PHP extensions for Laravel + MySQL
RUN apt-get update && apt-get install -y \
    git \
    unzip \
    libzip-dev \
    libicu-dev \
    libonig-dev \
    && docker-php-ext-install \
        pdo_mysql \
        intl \
        zip \
        mbstring \
        opcache \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Install PHP dependencies
COPY task-management-api/composer.json task-management-api/composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction

# Copy Laravel application source
COPY task-management-api/ ./
RUN composer dump-autoload --optimize --no-dev

# Copy compiled Angular SPA assets into Laravel's public/ directory
COPY --from=ui-build /app/ui/dist/task-management-ui/browser/ ./public/

# Ensure storage and cache directories are writable
RUN mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && chmod -R 775 storage bootstrap/cache

EXPOSE 8000

CMD ["sh", "-c", "php artisan config:cache && php artisan route:cache && php artisan migrate --force && php artisan serve --host=0.0.0.0 --port=${PORT:-8000}"]
