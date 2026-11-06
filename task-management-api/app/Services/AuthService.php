<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

/**
 * Authentication business logic for the first-party Angular SPA
 * (Sanctum stateful, session-cookie based).
 */
class AuthService
{
    private const GUARD = 'web';

    /**
     * Create a user (password hashed by the model cast) and start a session.
     *
     * @param  array{name: string, email: string, password: string}  $data
     */
    public function register(array $data, Request $request): User
    {
        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => $data['password'],
        ]);

        Auth::guard(self::GUARD)->login($user);
        $this->regenerateSession($request);

        return $user;
    }

    /**
     * Verify credentials and start a session.
     *
     * @throws ValidationException when the credentials are invalid
     */
    public function login(string $email, string $password, bool $remember, Request $request): User
    {
        if (! Auth::guard(self::GUARD)->attempt(['email' => $email, 'password' => $password], $remember)) {
            throw ValidationException::withMessages([
                'email' => __('auth.failed'),
            ]);
        }

        $this->regenerateSession($request);

        /** @var User */
        return Auth::guard(self::GUARD)->user();
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
     * Prevent session fixation by issuing a new session id after authentication.
     */
    private function regenerateSession(Request $request): void
    {
        if ($request->hasSession()) {
            $request->session()->regenerate();
        }
    }
}
