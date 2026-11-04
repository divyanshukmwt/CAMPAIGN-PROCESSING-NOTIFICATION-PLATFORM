<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Reports API availability and database connectivity.
 *
 * Used by developers, monitoring tools and the Angular client to verify
 * that the Laravel API can reach MySQL.
 */
class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        try {
            DB::connection()->select('select 1');
            $database = 'connected';
            $status = 200;
        } catch (Throwable $e) {
            Log::error('Health check: database unreachable', ['error' => $e->getMessage()]);
            $database = 'unavailable';
            $status = 503;
        }

        return response()->json([
            'status' => $status === 200 ? 'ok' : 'degraded',
            'service' => config('app.name'),
            'database' => $database,
            'timestamp' => now()->toIso8601String(),
        ], $status);
    }
}
