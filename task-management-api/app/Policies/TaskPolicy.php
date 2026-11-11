<?php

declare(strict_types=1);

namespace App\Policies;

use App\Models\Task;
use App\Models\User;

/**
 * Role-aware authorisation rules for tasks:
 * - Users acting in the `admin` role may view, update, assign, and delete any task.
 * - Users acting in the `user` role may view and update tasks they created or tasks
 *   assigned to them, and may delete tasks they created.
 */
class TaskPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return true;
    }

    public function assign(User $user): bool
    {
        return $user->isActingAsAdmin();
    }

    public function view(User $user, Task $task): bool
    {
        return $user->isActingAsAdmin() || $this->isCreatorOrAssignee($user, $task);
    }

    public function update(User $user, Task $task): bool
    {
        return $user->isActingAsAdmin() || $this->isCreatorOrAssignee($user, $task);
    }

    public function delete(User $user, Task $task): bool
    {
        return $user->isActingAsAdmin() || $this->owns($user, $task);
    }

    private function owns(User $user, Task $task): bool
    {
        return $user->id === $task->user_id;
    }

    private function isCreatorOrAssignee(User $user, Task $task): bool
    {
        return $this->owns($user, $task)
            || ($task->assigned_to_user_id !== null && $user->id === $task->assigned_to_user_id);
    }
}
