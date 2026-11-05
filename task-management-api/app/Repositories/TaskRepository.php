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
    public function all(): Collection
    {
        // Equivalent SQL: SELECT * FROM tasks ORDER BY created_at DESC, id DESC
        return Task::query()->latest()->latest('id')->get();
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
