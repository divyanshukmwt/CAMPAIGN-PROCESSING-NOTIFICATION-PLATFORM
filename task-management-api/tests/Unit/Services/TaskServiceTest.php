<?php

namespace Tests\Unit\Services;

use App\Contracts\TaskRepositoryInterface;
use App\Models\Task;
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

    protected function setUp(): void
    {
        parent::setUp();
        Log::spy();
        $this->repository = Mockery::mock(TaskRepositoryInterface::class);
        $this->service = new TaskService($this->repository);
    }

    private function task(int $id = 1): Task
    {
        $task = new Task(['title' => 'Stub']);
        $task->id = $id;

        return $task;
    }

    public function test_get_all_tasks_delegates_to_repository(): void
    {
        $collection = new Collection([$this->task()]);
        $this->repository->shouldReceive('all')->once()->with(null)->andReturn($collection);

        $this->assertSame($collection, $this->service->getAllTasks());
    }

    public function test_get_all_tasks_passes_search_term_to_repository(): void
    {
        $collection = new Collection;
        $this->repository->shouldReceive('all')->once()->with('laravel')->andReturn($collection);

        $this->assertSame($collection, $this->service->getAllTasks('laravel'));
    }

    public function test_get_task_uses_find_or_fail(): void
    {
        $task = $this->task(5);
        $this->repository->shouldReceive('findOrFail')->once()->with(5)->andReturn($task);

        $this->assertSame($task, $this->service->getTask(5));
    }

    public function test_create_applies_default_status_and_priority_and_normalises_input(): void
    {
        $this->repository->shouldReceive('create')->once()
            ->with([
                'title' => 'Trimmed',
                'description' => null,
                'status' => 'Pending',
                'priority' => 'Medium',
            ])
            ->andReturn($this->task(10));

        $this->service->createTask(['title' => '  Trimmed  ', 'description' => '   ']);

        Log::shouldHaveReceived('info')->with('Task created', ['task_id' => 10]);
    }

    public function test_create_keeps_explicit_status_and_priority(): void
    {
        $this->repository->shouldReceive('create')->once()
            ->with(Mockery::on(fn (array $d) => $d['status'] === 'Completed' && $d['priority'] === 'High'))
            ->andReturn($this->task());

        $this->service->createTask(['title' => 'X', 'status' => 'Completed', 'priority' => 'High']);
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
