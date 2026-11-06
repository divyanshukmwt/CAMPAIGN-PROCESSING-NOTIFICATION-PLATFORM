<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Contracts\TaskRepositoryInterface;
use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;

/**
 * Eloquent implementation of the task repository.
 */
class TaskRepository implements TaskRepositoryInterface
{
    public function allForUser(User $user, ?string $search = null): Collection
    {
        // Equivalent SQL: SELECT * FROM tasks WHERE user_id = ? [AND title LIKE ?]
        //                 ORDER BY created_at DESC, id DESC
        return Task::query()
            ->where('user_id', $user->id)
            ->when($search !== null && $search !== '', function ($query) use ($search) {
                // Escape LIKE wildcards so user input is matched literally (value is bound, never concatenated).
                $escaped = addcslashes((string) $search, '\\%_');
                $query->where('title', 'like', '%'.$escaped.'%');
            })
            ->latest()
            ->latest('id')
            ->get();
    }

    public function find(int $id): ?Task
    {
        return Task::query()->find($id);
    }

    public function findOrFail(int $id): Task
    {
        return Task::query()->findOrFail($id);
    }

    public function create(User $owner, array $data): Task
    {
        return $owner->tasks()->create($data)->refresh();
    }

    public function update(Task $task, array $data): Task
    {
        $task->update($data);

        return $task->refresh();
    }

    public function delete(Task $task): bool
    {
        return (bool) $task->delete();
    }
}
