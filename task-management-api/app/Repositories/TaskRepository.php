<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Contracts\TaskRepositoryInterface;
use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;

/**
 * Eloquent implementation of the task repository.
 */
class TaskRepository implements TaskRepositoryInterface
{
    public function allForUser(User $user, ?string $search = null): Collection
    {
        return Task::query()
            ->with(['user', 'assignee', 'assigner'])
            ->where(function (Builder $query) use ($user): void {
                $query->where('user_id', $user->id)
                    ->orWhere('assigned_to_user_id', $user->id);
            })
            ->when($search !== null && $search !== '', function (Builder $query) use ($search): void {
                $escaped = addcslashes((string) $search, '\\%_');
                $query->where('title', 'like', '%'.$escaped.'%');
            })
            ->latest()
            ->latest('id')
            ->get();
    }

    public function allForAdmin(?string $search = null, ?int $filterUserId = null): Collection
    {
        return Task::query()
            ->with(['user', 'assignee', 'assigner'])
            ->when($filterUserId !== null, function (Builder $query) use ($filterUserId): void {
                $query->where(function (Builder $sub) use ($filterUserId): void {
                    $sub->where('user_id', $filterUserId)
                        ->orWhere('assigned_to_user_id', $filterUserId);
                });
            })
            ->when($search !== null && $search !== '', function (Builder $query) use ($search): void {
                $escaped = addcslashes((string) $search, '\\%_');
                $query->where('title', 'like', '%'.$escaped.'%');
            })
            ->latest()
            ->latest('id')
            ->get();
    }

    public function find(int $id): ?Task
    {
        return Task::query()->with(['user', 'assignee', 'assigner'])->find($id);
    }

    public function findOrFail(int $id): Task
    {
        return Task::query()->with(['user', 'assignee', 'assigner'])->findOrFail($id);
    }

    public function create(User $owner, array $data): Task
    {
        $assignedToUserId = isset($data['assigned_to_user_id'])
            ? (int) $data['assigned_to_user_id']
            : $owner->id;

        $assignedByUserId = isset($data['assigned_by_user_id'])
            ? (int) $data['assigned_by_user_id']
            : $owner->id;

        $task = $owner->tasks()->make($data);
        $task->forceFill([
            'assigned_to_user_id' => $assignedToUserId,
            'assigned_by_user_id' => $assignedByUserId,
        ])->save();

        return $task->refresh()->load(['user', 'assignee', 'assigner']);
    }

    public function update(Task $task, array $data): Task
    {
        $assignmentUpdates = [];
        if (array_key_exists('assigned_to_user_id', $data) && $data['assigned_to_user_id'] !== null) {
            $assignmentUpdates['assigned_to_user_id'] = (int) $data['assigned_to_user_id'];
        }
        if (array_key_exists('assigned_by_user_id', $data) && $data['assigned_by_user_id'] !== null) {
            $assignmentUpdates['assigned_by_user_id'] = (int) $data['assigned_by_user_id'];
        }

        $task->fill($data);
        if ($assignmentUpdates !== []) {
            $task->forceFill($assignmentUpdates);
        }
        $task->save();

        return $task->refresh()->load(['user', 'assignee', 'assigner']);
    }

    public function delete(Task $task): bool
    {
        return (bool) $task->delete();
    }
}
