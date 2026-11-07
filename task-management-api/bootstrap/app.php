<?php

use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Trust reverse-proxy headers (Railway / Render HTTPS termination).
        $middleware->trustProxies(at: '*');

        // Sanctum SPA authentication: requests from SANCTUM_STATEFUL_DOMAINS
        // get session cookies + CSRF protection on the api route group.
        $middleware->statefulApi();

        // Apply the named "api" rate limiter to every API route.
        $middleware->throttleApi();
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        /*
        | Centralised JSON error handling for the API.
        | Validation (422) and authentication (401) errors keep Laravel's
        | standard JSON shape: { "message": "...", "errors": { ... } }.
        */
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        // 404 — unknown record or route. Never expose model class names.
        $exceptions->render(function (NotFoundHttpException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $previous = $e->getPrevious();
            $message = $previous instanceof ModelNotFoundException
                ? Str::headline(class_basename($previous->getModel())).' not found.'
                : 'The requested resource was not found.';

            return response()->json(['message' => $message], 404);
        });

        // 405 — wrong HTTP method for an existing endpoint.
        $exceptions->render(function (MethodNotAllowedHttpException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return response()->json(['message' => 'The HTTP method is not allowed for this endpoint.'], 405)
                ->withHeaders($e->getHeaders());
        });

        // 500 — unexpected errors: generic message in production (details only when APP_DEBUG=true).
        $exceptions->render(function (Throwable $e, Request $request) {
            if (! $request->is('api/*') || config('app.debug')) {
                return null;
            }
            if ($e instanceof HttpExceptionInterface
                || $e instanceof ValidationException
                || $e instanceof AuthenticationException
                || $e instanceof AuthorizationException) {
                return null;
            }

            return response()->json(['message' => 'An unexpected error occurred. Please try again later.'], 500);
        });
    })->create();
