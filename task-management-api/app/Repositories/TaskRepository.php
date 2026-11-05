<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Contracts\TaskRepositoryInterface;
use App\Models\Task;
use Illuminate\Database\Eloquent\Collection;

/**
 * Eloquent implementation of the task repository.
 */
class TaskRepository implements TaskRepositoryInterface
{
    public function all(?string $search = null): Collection
    {
        // Equivalent SQL: SELECT * FROM tasks [WHERE title LIKE ?] ORDER BY created_at DESC, id DESC
        return Task::query()
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

    public function create(array $data): Task
    {
        return Task::create($data)->refresh();
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
