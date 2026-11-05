<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * Allowed task priorities (stored as VARCHAR(20) in the `tasks` table).
 */
enum TaskPriority: string
{
    case Low = 'Low';
    case Medium = 'Medium';
    case High = 'High';

    public const DEFAULT = self::Medium;

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
