<?php

namespace Tests\Unit\Services;

use App\Contracts\TaskRepositoryInterface;
use App\Models\Task;
use App\Models\User;
use App\Services\TaskService;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Log;
use Mockery;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * Unit tests for TaskService with a mocked repository (no database).
 */
class TaskServiceTest extends TestCase
{
    private TaskRepositoryInterface&MockInterface $repository;

    private TaskService $service;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        Log::spy();
        $this->repository = Mockery::mock(TaskRepositoryInterface::class);
        $this->service = new TaskService($this->repository);
        $this->user = new User;
        $this->user->id = 42;
    }

    private function task(int $id = 1): Task
    {
        $task = new Task(['title' => 'Stub']);
        $task->id = $id;

        return $task;
    }

    public function test_get_all_tasks_is_scoped_to_the_user(): void
    {
        $collection = new Collection([$this->task()]);
        $this->repository->shouldReceive('allForUser')->once()->with($this->user, null)->andReturn($collection);

        $this->assertSame($collection, $this->service->getAllTasks($this->user));
    }

    public function test_get_all_tasks_passes_search_term_to_repository(): void
    {
        $collection = new Collection;
        $this->repository->shouldReceive('allForUser')->once()->with($this->user, 'laravel')->andReturn($collection);

        $this->assertSame($collection, $this->service->getAllTasks($this->user, 'laravel'));
    }

    public function test_get_task_uses_find_or_fail(): void
    {
        $task = $this->task(5);
        $this->repository->shouldReceive('findOrFail')->once()->with(5)->andReturn($task);

        $this->assertSame($task, $this->service->getTask(5));
    }

    public function test_create_applies_defaults_normalises_input_and_assigns_owner(): void
    {
        $this->repository->shouldReceive('create')->once()
            ->with($this->user, [
                'title' => 'Trimmed',
                'description' => null,
                'status' => 'Pending',
                'priority' => 'Medium',
            ])
            ->andReturn($this->task(10));

        $this->service->createTask($this->user, ['title' => '  Trimmed  ', 'description' => '   ']);

        Log::shouldHaveReceived('info')->with('Task created', ['task_id' => 10, 'user_id' => 42]);
    }

    public function test_create_keeps_explicit_status_and_priority(): void
    {
        $this->repository->shouldReceive('create')->once()
            ->with($this->user, Mockery::on(fn (array $d) => $d['status'] === 'Completed' && $d['priority'] === 'High'))
            ->andReturn($this->task());

        $this->service->createTask($this->user, ['title' => 'X', 'status' => 'Completed', 'priority' => 'High']);
    }

    public function test_update_passes_only_provided_fields(): void
    {
        $task = $this->task(3);
        $this->repository->shouldReceive('update')->once()
            ->with($task, ['status' => 'In Progress'])
            ->andReturn($task);

        $this->assertSame($task, $this->service->updateTask($task, ['status' => 'In Progress']));
        Log::shouldHaveReceived('info')->with('Task updated', ['task_id' => 3, 'fields' => ['status']]);
    }

    public function test_delete_delegates_and_logs(): void
    {
        $task = $this->task(7);
        $this->repository->shouldReceive('delete')->once()->with($task)->andReturn(true);

        $this->assertTrue($this->service->deleteTask($task));
        Log::shouldHaveReceived('info')->with('Task deleted', ['task_id' => 7]);
    }
}
