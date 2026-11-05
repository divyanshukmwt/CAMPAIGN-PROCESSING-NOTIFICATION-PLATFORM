<?php

declare(strict_types=1);

namespace App\Contracts;

use App\Models\Task;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * Data-access contract for tasks.
 *
 * Business rules live in App\Services\TaskService; implementations of this
 * interface only read and write persistence.
 */
interface TaskRepositoryInterface
{
    /**
     * All tasks, newest first, optionally filtered by a title search term.
     *
     * @return Collection<int, Task>
     */
    public function all(?string $search = null): Collection;

    public function find(int $id): ?Task;

    /**
     * @throws ModelNotFoundException
     */
    public function findOrFail(int $id): Task;

    /**
     * @param  array<string, mixed>  $data
     */
    public function create(array $data): Task;

    /**
     * @param  array<string, mixed>  $data
     */
    public function update(Task $task, array $data): Task;

    public function delete(Task $task): bool;
}
