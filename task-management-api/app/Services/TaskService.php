<?php

declare(strict_types=1);

namespace App\Services;

use App\Contracts\TaskRepositoryInterface;
use App\Enums\TaskPriority;
use App\Enums\TaskStatus;
use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Log;

/**
 * Business logic for tasks, including RBAC scoping and task assignment.
 *
 * Controllers delegate here; persistence is delegated to the repository.
 */
class TaskService
{
    public function __construct(
        private readonly TaskRepositoryInterface $tasks,
    ) {}

    /**
     * Tasks visible to the user (all tasks when acting as `admin`, or tasks
     * created by / assigned to the user when acting as `user`), newest first.
     *
     * @param  string|null  $search  Optional case-insensitive title search term.
     * @param  int|null  $filterUserId  Optional user ID filter (Admin role only).
     * @return Collection<int, Task>
     */
    public function getAllTasks(User $user, ?string $search = null, ?int $filterUserId = null): Collection
    {
        if ($user->isActingAsAdmin()) {
            return $this->tasks->allForAdmin($search, $filterUserId);
        }

        return $this->tasks->allForUser($user, $search);
    }

    public function getTask(int $id): Task
    {
        return $this->tasks->findOrFail($id);
    }

    /**
     * Create a task owned by the given user (and optionally assigned to another
     * user when created by an Admin).
     *
     * @param  array<string, mixed>  $data  Validated input.
     */
    public function createTask(User $owner, array $data): Task
    {
        $data = $this->normalise($data);
        $data['status'] ??= TaskStatus::DEFAULT->value;
        $data['priority'] ??= TaskPriority::DEFAULT->value;

        if (isset($data['assigned_to_user_id']) && $data['assigned_to_user_id'] !== null && $owner->isActingAsAdmin()) {
            $data['assigned_to_user_id'] = (int) $data['assigned_to_user_id'];
            $data['assigned_by_user_id'] = $owner->id;
        } else {
            unset($data['assigned_to_user_id'], $data['assigned_by_user_id']);
        }

        $task = $this->tasks->create($owner, $data);

        Log::info('Task created', ['task_id' => $task->id, 'user_id' => $owner->id]);

        return $task;
    }

    /**
     * @param  array<string, mixed>  $data  Validated (possibly partial) input.
     */
    public function updateTask(Task $task, array $data, ?User $actor = null): Task
    {
        $normalised = $this->normalise($data);

        if (array_key_exists('assigned_to_user_id', $normalised)) {
            if ($actor !== null && $actor->isActingAsAdmin() && $normalised['assigned_to_user_id'] !== null) {
                $normalised['assigned_to_user_id'] = (int) $normalised['assigned_to_user_id'];
                $normalised['assigned_by_user_id'] = $actor->id;
            } else {
                unset($normalised['assigned_to_user_id'], $normalised['assigned_by_user_id']);
            }
        }

        $task = $this->tasks->update($task, $normalised);

        Log::info('Task updated', ['task_id' => $task->id, 'fields' => array_keys($data)]);

        return $task;
    }

    public function deleteTask(Task $task): bool
    {
        $id = $task->id;
        $deleted = $this->tasks->delete($task);

        Log::info('Task deleted', ['task_id' => $id]);

        return $deleted;
    }

    /**
     * Trim the title and convert blank optional strings to null.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function normalise(array $data): array
    {
        if (isset($data['title']) && is_string($data['title'])) {
            $data['title'] = trim($data['title']);
        }

        foreach (['description', 'due_date'] as $field) {
            if (array_key_exists($field, $data) && is_string($data[$field]) && trim($data[$field]) === '') {
                $data[$field] = null;
            }
        }

        return $data;
    }
}
