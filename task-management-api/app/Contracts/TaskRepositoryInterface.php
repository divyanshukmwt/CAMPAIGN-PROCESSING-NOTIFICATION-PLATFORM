<?php

declare(strict_types=1);

namespace App\Contracts;

use App\Models\Task;
use App\Models\User;
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
     * Tasks created by or assigned to the given user, newest first,
     * optionally filtered by a title search term.
     *
     * @return Collection<int, Task>
     */
    public function allForUser(User $user, ?string $search = null): Collection;

    /**
     * All tasks across all users (for Admin role), newest first,
     * optionally filtered by title search term and/or user ID.
     *
     * @return Collection<int, Task>
     */
    public function allForAdmin(?string $search = null, ?int $filterUserId = null): Collection;

    public function find(int $id): ?Task;

    /**
     * @throws ModelNotFoundException
     */
    public function findOrFail(int $id): Task;

    /**
     * Create a task owned by the given user.
     *
     * @param  array<string, mixed>  $data
     */
    public function create(User $owner, array $data): Task;

    /**
     * @param  array<string, mixed>  $data
     */
    public function update(Task $task, array $data): Task;

    public function delete(Task $task): bool;
}
