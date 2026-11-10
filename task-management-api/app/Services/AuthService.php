<?php

declare(strict_types=1);

namespace App\Services;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Authentication, RBAC role resolution, and single-tab session security
 * business logic for the first-party Angular SPA.
 */
class AuthService
{
    private const GUARD = 'web';

    /**
     * Create a user (password hashed by the model cast) and start a session.
     *
     * @param  array{name: string, email: string, password: string, role?: string, dual_role?: bool}  $data
     */
    public function register(array $data, Request $request): User
    {
        $requestedRole = isset($data['role'])
            ? (UserRole::tryFrom((string) $data['role']) ?? UserRole::DEFAULT)
            : UserRole::DEFAULT;

        $dualRole = filter_var($data['dual_role'] ?? false, FILTER_VALIDATE_BOOLEAN);

        $roles = ($dualRole || $requestedRole === UserRole::Admin)
            ? [UserRole::Admin->value, UserRole::User->value]
            : [UserRole::User->value];

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => $data['password'],
        ]);

        $user->forceFill(['roles' => $roles])->save();
        $user->setActiveRole($requestedRole);

        event(new Registered($user));

        Auth::guard(self::GUARD)->login($user);
        $this->initialiseSecureSession($request, $user, $requestedRole);

        return $user;
    }

    /**
     * Verify credentials, validate role authorisation, and start a session.
     *
     * @throws ValidationException when the credentials or requested role are invalid
     */
    public function login(
        string $email,
        string $password,
        bool $remember,
        Request $request,
        ?string $requestedRole = null,
    ): User {
        if (! Auth::guard(self::GUARD)->attempt(['email' => $email, 'password' => $password], $remember)) {
            throw ValidationException::withMessages([
                'email' => __('auth.failed'),
            ]);
        }

        /** @var User $user */
        $user = Auth::guard(self::GUARD)->user();

        if ($requestedRole !== null && $requestedRole !== '') {
            $role = UserRole::tryFrom($requestedRole) ?? UserRole::DEFAULT;

            if (! $user->hasRole($role)) {
                Auth::guard(self::GUARD)->logout();

                if ($request->hasSession()) {
                    $request->session()->invalidate();
                    $request->session()->regenerateToken();
                }

                Log::channel('security')->warning('Unauthorized role login attempt', [
                    'user_id' => $user->id,
                    'requested_role' => $role->value,
                    'ip' => $request->ip(),
                ]);

                throw ValidationException::withMessages([
                    'role' => ['You do not have permission to sign in with the selected role.'],
                ]);
            }
        } else {
            $role = $user->activeRole();
        }

        $user->setActiveRole($role);
        $this->initialiseSecureSession($request, $user, $role);

        return $user;
    }

    /**
     * Switch the active role of the authenticated user within their session.
     *
     * @throws AccessDeniedHttpException when the user does not hold the target role
     */
    public function switchRole(User $user, UserRole|string $targetRole, Request $request): User
    {
        $role = $targetRole instanceof UserRole ? $targetRole : UserRole::from($targetRole);

        if (! $user->hasRole($role)) {
            Log::channel('security')->warning('Unauthorized role switch attempt', [
                'user_id' => $user->id,
                'requested_role' => $role->value,
                'ip' => $request->ip(),
            ]);

            throw new AccessDeniedHttpException('You do not have permission to switch to the requested role.');
        }

        $previousRole = $user->activeRole()->value;
        $user->setActiveRole($role);

        $tabToken = bin2hex(random_bytes(32));

        if ($request->hasSession()) {
            $existingToken = $request->session()->get('tab_token');
            if (is_string($existingToken) && $existingToken !== '') {
                $tabToken = $existingToken;
            }
            $requireTabToken = (bool) $request->session()->get('require_tab_token', false);

            $request->session()->regenerate();
            $request->session()->put([
                'active_role' => $role->value,
                'tab_token' => $tabToken,
                'ua_hash' => self::userAgentHash($request),
                'last_activity_at' => now()->timestamp,
                'require_tab_token' => $requireTabToken,
            ]);

            $this->purgeOtherUserSessions($user->id, $request->session()->getId());
        }

        $request->attributes->set('tab_token', $tabToken);

        Log::channel('security')->info('Role switched', [
            'user_id' => $user->id,
            'from_role' => $previousRole,
            'to_role' => $role->value,
            'ip' => $request->ip(),
        ]);

        return $user;
    }

    /**
     * End the session and rotate the CSRF token.
     */
    public function logout(Request $request): void
    {
        Auth::guard(self::GUARD)->logout();

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }
    }

    /**
     * Retrieve the cryptographic per-tab token bound to the current request/session.
     */
    public function currentTabToken(Request $request): ?string
    {
        $attrToken = $request->attributes->get('tab_token');
        if (is_string($attrToken) && $attrToken !== '') {
            return $attrToken;
        }

        if ($request->hasSession()) {
            $sessionToken = $request->session()->get('tab_token');
            if (is_string($sessionToken) && $sessionToken !== '') {
                return $sessionToken;
            }
        }

        return null;
    }

    public static function userAgentHash(Request $request): string
    {
        return hash('sha256', (string) $request->userAgent());
    }

    /**
     * Regenerate the session ID, issue a cryptographic per-tab token, bind the
     * User-Agent fingerprint, and terminate any other active sessions for this user.
     */
    private function initialiseSecureSession(Request $request, User $user, UserRole $activeRole): void
    {
        $tabToken = bin2hex(random_bytes(32));
        $request->attributes->set('tab_token', $tabToken);

        if ($request->hasSession()) {
            $request->session()->regenerate();

            $requireTabToken = $request->hasHeader('X-Tab-Id')
                || $request->hasHeader('X-Require-Tab-Token')
                || $request->boolean('require_tab_token');

            $request->session()->put([
                'active_role' => $activeRole->value,
                'tab_token' => $tabToken,
                'ua_hash' => self::userAgentHash($request),
                'last_activity_at' => now()->timestamp,
                'require_tab_token' => $requireTabToken,
            ]);

            $this->purgeOtherUserSessions($user->id, $request->session()->getId());
        }
    }

    /**
     * Enforce a single active session per user when the database session driver is used.
     */
    private function purgeOtherUserSessions(int $userId, string $currentSessionId): void
    {
        if (config('session.driver') !== 'database') {
            return;
        }

        $table = (string) config('session.table', 'sessions');
        if (! Schema::hasTable($table)) {
            return;
        }

        DB::table($table)
            ->where('user_id', $userId)
            ->where('id', '!=', $currentSessionId)
            ->delete();
    }
}
