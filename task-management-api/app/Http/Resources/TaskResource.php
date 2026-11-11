<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\Task;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * JSON representation of a task including attribution metadata
 * (`created_by`, `assigned_by`, `assigned_to`).
 *
 * @mixin Task
 */
class TaskResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $creator = $this->user;
        $assignee = $this->assignee ?? $creator;
        $assigner = $this->assigner ?? $creator;

        return [
            'id' => $this->id,
            'title' => $this->title,
            'description' => $this->description,
            'status' => $this->status->value,
            'priority' => $this->priority->value,
            'due_date' => $this->due_date?->format('Y-m-d'),
            'assigned_to_user_id' => $this->assigned_to_user_id ?? $this->user_id,
            'created_by' => self::userSummary($creator),
            'assigned_to' => self::userSummary($assignee),
            'assigned_by' => self::userSummary($assigner),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{id: int, name: string, email: string}|null
     */
    private static function userSummary(?User $user): ?array
    {
        if ($user === null) {
            return null;
        }

        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
        ];
    }
}
