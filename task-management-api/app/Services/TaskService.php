<?php

declare(strict_types=1);

namespace App\Services;

use App\Contracts\TaskRepositoryInterface;
use App\Enums\TaskPriority;
use App\Enums\TaskStatus;
use App\Models\Task;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Log;

/**
 * Business logic for tasks.
 *
 * Controllers delegate here; persistence is delegated to the repository.
 */
class TaskService
{
    public function __construct(
        private readonly TaskRepositoryInterface $tasks,
    ) {}

    /**
     * @return Collection<int, Task>
     */
    public function getAllTasks(): Collection
    {
        return $this->tasks->all();
    }

    public function getTask(int $id): Task
    {
        return $this->tasks->findOrFail($id);
    }

    /**
     * @param  array<string, mixed>  $data  Validated input.
     */
    public function createTask(array $data): Task
    {
        $data = $this->normalise($data);
        $data['status'] ??= TaskStatus::DEFAULT->value;
        $data['priority'] ??= TaskPriority::DEFAULT->value;

        $task = $this->tasks->create($data);

        Log::info('Task created', ['task_id' => $task->id]);

        return $task;
    }

    /**
     * @param  array<string, mixed>  $data  Validated (possibly partial) input.
     */
    public function updateTask(Task $task, array $data): Task
    {
        $task = $this->tasks->update($task, $this->normalise($data));

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
