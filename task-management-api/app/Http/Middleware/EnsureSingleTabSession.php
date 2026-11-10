<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\User;
use App\Services\AuthService;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Enforces strict session security on authenticated API routes:
 *  1. Idle inactivity timeout (`SESSION_IDLE_TIMEOUT`, default 900s).
 *  2. User-Agent SHA-256 fingerprint binding (`ua_hash`).
 *  3. Per-tab cryptographic token binding (`X-Tab-Token` vs `session('tab_token')`).
 *  4. Active RBAC role hydration onto the authenticated `User` model.
 */
class EnsureSingleTabSession
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user instanceof User || ! $request->hasSession()) {
            return $next($request);
        }

        // 1. Enforce idle session timeout
        $idleTimeout = (int) config('session.idle_timeout', 900);
        $lastActivity = $request->session()->get('last_activity_at');

        if (is_int($lastActivity) && $idleTimeout > 0 && (now()->timestamp - $lastActivity) > $idleTimeout) {
            Log::channel('security')->info('Session expired due to inactivity', [
                'user_id' => $user->id,
                'ip' => $request->ip(),
            ]);

            $this->terminateSession($request);

            return response()->json([
                'message' => 'Session expired due to inactivity.',
                'code' => 'SESSION_IDLE_TIMEOUT',
            ], 401);
        }

        // 2. Verify User-Agent fingerprint binding
        $expectedUaHash = $request->session()->get('ua_hash');
        if (is_string($expectedUaHash) && $expectedUaHash !== '') {
            $actualUaHash = AuthService::userAgentHash($request);

            if (! hash_equals($expectedUaHash, $actualUaHash)) {
                Log::channel('security')->warning('Session User-Agent fingerprint mismatch', [
                    'user_id' => $user->id,
                    'ip' => $request->ip(),
                ]);

                $this->terminateSession($request);

                return response()->json([
                    'message' => 'Session security validation failed.',
                    'code' => 'SESSION_FINGERPRINT_MISMATCH',
                ], 401);
            }
        }

        // 3. Verify per-tab cryptographic token (blocks duplicate tabs sharing cookies)
        $sessionTabToken = $request->session()->get('tab_token');
        if (is_string($sessionTabToken) && $sessionTabToken !== '') {
            $hasHeader = $request->hasHeader('X-Tab-Token');
            $headerToken = (string) $request->header('X-Tab-Token', '');
            $requireTabToken = (bool) $request->session()->get('require_tab_token', false);

            if (($hasHeader && ! hash_equals($sessionTabToken, $headerToken)) || ($requireTabToken && ! $hasHeader)) {
                Log::channel('security')->warning('Duplicate tab or mismatched tab token detected', [
                    'user_id' => $user->id,
                    'ip' => $request->ip(),
                ]);

                return response()->json([
                    'message' => 'Active session is locked to another browser tab.',
                    'code' => 'TAB_CONFLICT',
                ], 409);
            }
        }

        // 4. Hydrate active role from server session onto the authenticated user
        $sessionRole = $request->session()->get('active_role');
        if (is_string($sessionRole) && $sessionRole !== '' && $user->hasRole($sessionRole)) {
            $user->setActiveRole($sessionRole);
        }

        $request->session()->put('last_activity_at', now()->timestamp);

        return $next($request);
    }

    private function terminateSession(Request $request): void
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
    }
}
