<?php

declare(strict_types=1);

namespace App\Listeners;

use Illuminate\Auth\Events\Failed;
use Illuminate\Auth\Events\Login;
use Illuminate\Auth\Events\Logout;
use Illuminate\Auth\Events\Registered;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Request;

/**
 * Writes authentication events to the "security" log channel.
 *
 * Registered automatically through Laravel event discovery (one handler
 * method per event type). Passwords are never logged and email addresses
 * of failed attempts are masked.
 */
class LogAuthenticationEvents
{
    public function handleLogin(Login $event): void
    {
        Log::channel('security')->info('Login succeeded', [
            'user_id' => $event->user->getAuthIdentifier(),
            'guard' => $event->guard,
            'remember' => $event->remember,
            'ip' => Request::ip(),
        ]);
    }

    public function handleFailed(Failed $event): void
    {
        Log::channel('security')->warning('Login failed', [
            'email' => self::maskEmail((string) ($event->credentials['email'] ?? '')),
            'user_exists' => $event->user !== null,
            'ip' => Request::ip(),
        ]);
    }

    public function handleLogout(Logout $event): void
    {
        Log::channel('security')->info('Logout', [
            'user_id' => $event->user?->getAuthIdentifier(),
            'ip' => Request::ip(),
        ]);
    }

    public function handleRegistered(Registered $event): void
    {
        Log::channel('security')->info('User registered', [
            'user_id' => $event->user->getAuthIdentifier(),
            'ip' => Request::ip(),
        ]);
    }

    /**
     * jane.doe@example.com -> j*******@example.com
     */
    public static function maskEmail(string $email): string
    {
        if (! str_contains($email, '@')) {
            return $email === '' ? '' : mb_substr($email, 0, 1).'***';
        }

        [$local, $domain] = explode('@', $email, 2);

        return mb_substr($local, 0, 1).str_repeat('*', max(mb_strlen($local) - 1, 1)).'@'.$domain;
    }
}
