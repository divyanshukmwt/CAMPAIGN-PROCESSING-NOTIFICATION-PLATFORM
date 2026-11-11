<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Enums\TaskPriority;
use App\Enums\TaskStatus;
use App\Models\Task;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validates payloads for creating a task (POST /api/tasks).
 */
class StoreTaskRequest extends FormRequest
{
    public function authorize(): bool
    {
        $user = $this->user();
        if ($user === null || ! $user->can('create', Task::class)) {
            return false;
        }

        if ($this->filled('assigned_to_user_id') && (int) $this->input('assigned_to_user_id') !== $user->id) {
            return $user->can('assign', Task::class);
        }

        return true;
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'status' => ['required', Rule::enum(TaskStatus::class)],
            'priority' => ['required', Rule::enum(TaskPriority::class)],
            'due_date' => ['nullable', 'date'],
            'assigned_to_user_id' => ['sometimes', 'nullable', 'integer', 'exists:users,id'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'status.enum' => 'The status must be one of: '.implode(', ', TaskStatus::values()).'.',
            'priority.enum' => 'The priority must be one of: '.implode(', ', TaskPriority::values()).'.',
        ];
    }
}
