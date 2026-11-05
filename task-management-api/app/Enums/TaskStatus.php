<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * Allowed task statuses (stored as VARCHAR(30) in the `tasks` table).
 */
enum TaskStatus: string
{
    case Pending = 'Pending';
    case InProgress = 'In Progress';
    case Completed = 'Completed';

    public const DEFAULT = self::Pending;

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
