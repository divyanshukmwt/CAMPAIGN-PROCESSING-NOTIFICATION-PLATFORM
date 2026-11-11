<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Enums\TaskPriority;
use App\Enums\TaskStatus;
use App\Models\Task;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validates payloads for updating a task (PUT/PATCH /api/tasks/{id}).
 *
 * All fields are optional ("sometimes") so partial updates are supported,
 * but a field that is present must be valid.
 */
class UpdateTaskRequest extends FormRequest
{
    /**
     * Only the task owner/assignee or an active Admin may update it (TaskPolicy::update).
     * Reassigning a task to another user requires the active Admin role (TaskPolicy::assign).
     */
    public function authorize(): bool
    {
        $task = $this->route('task');
        $user = $this->user();

        if (! $task instanceof Task || $user === null || ! $user->can('update', $task)) {
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
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string'],
            'status' => ['sometimes', 'required', Rule::enum(TaskStatus::class)],
            'priority' => ['sometimes', 'required', Rule::enum(TaskPriority::class)],
            'due_date' => ['sometimes', 'nullable', 'date'],
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
