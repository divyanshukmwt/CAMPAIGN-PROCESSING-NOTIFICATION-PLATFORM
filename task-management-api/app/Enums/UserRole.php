<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * Allowed RBAC roles for user accounts and active sessions.
 *
 * A single user account may hold one role (`['user']` or `['admin']`) or
 * both roles (`['admin', 'user']`), while operating under a single
 * session-bound active role at any given time.
 */
enum UserRole: string
{
    case Admin = 'admin';
    case User = 'user';

    public const DEFAULT = self::User;

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
