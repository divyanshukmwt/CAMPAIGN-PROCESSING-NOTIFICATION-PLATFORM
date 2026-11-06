<?php

namespace App\Providers;

use App\Contracts\TaskRepositoryInterface;
use App\Listeners\LogAuthenticationEvents;
use App\Repositories\TaskRepository;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Interface-to-implementation bindings resolved by the service container.
     *
     * @var array<class-string, class-string>
     */
    public array $bindings = [
        TaskRepositoryInterface::class => TaskRepository::class,
    ];

    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // API responses follow the documented contract: collections are plain
        // JSON arrays and single resources are plain objects (no "data" wrapper).
        JsonResource::withoutWrapping();

        $this->configureRateLimiting();
    }

    /**
     * Named rate limiters (DOCX §21 "API throttling").
     *
     * - api:      general API traffic, per authenticated user (or IP for guests)
     * - login:    brute-force protection, per email + IP
     * - register: account-creation abuse protection, per IP
     */
    private function configureRateLimiting(): void
    {
        RateLimiter::for('api', function (Request $request) {
            return Limit::perMinute((int) config('services.rate_limits.api', 60))
                ->by($request->user()?->getAuthIdentifier() ?: $request->ip());
        });

        RateLimiter::for('login', function (Request $request) {
            $email = strtolower(trim((string) $request->input('email')));

            return Limit::perMinute((int) config('services.rate_limits.login', 5))
                ->by($email.'|'.$request->ip())
                ->response(fn (Request $request, array $headers) => $this->tooManyAttempts(
                    'Too many login attempts. Please try again later.',
                    'Login rate limit exceeded',
                    $request,
                    $headers,
                    ['email' => LogAuthenticationEvents::maskEmail($email)],
                ));
        });

        RateLimiter::for('register', function (Request $request) {
            return Limit::perMinute((int) config('services.rate_limits.register', 10))
                ->by($request->ip())
                ->response(fn (Request $request, array $headers) => $this->tooManyAttempts(
                    'Too many registration attempts. Please try again later.',
                    'Registration rate limit exceeded',
                    $request,
                    $headers,
                ));
        });
    }

    /**
     * @param  array<string, mixed>  $headers
     * @param  array<string, mixed>  $context
     */
    private function tooManyAttempts(string $message, string $logMessage, Request $request, array $headers, array $context = []): JsonResponse
    {
        Log::channel('security')->warning($logMessage, $context + ['ip' => $request->ip()]);

        return response()->json(['message' => $message], 429, $headers);
    }
}
