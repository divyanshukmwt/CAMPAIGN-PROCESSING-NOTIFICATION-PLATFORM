<?php

namespace Tests\Feature\Services;

use App\Enums\TaskPriority;
use App\Enums\TaskStatus;
use App\Models\Task;
use App\Models\User;
use App\Services\TaskService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Integration tests: TaskService resolved from the container, real repository + MySQL.
 */
class TaskServiceIntegrationTest extends TestCase
{
    use RefreshDatabase;

    private TaskService $service;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = $this->app->make(TaskService::class);
        $this->user = User::factory()->create();
    }

    public function test_full_task_lifecycle(): void
    {
        $task = $this->service->createTask($this->user, [
            'title' => 'Learn Laravel',
            'description' => 'Understand Laravel API development',
            'status' => 'Pending',
            'priority' => 'High',
            'due_date' => '2026-12-31',
        ]);
        $this->assertDatabaseHas('tasks', ['id' => $task->id, 'title' => 'Learn Laravel', 'user_id' => $this->user->id]);

        $this->assertTrue($task->is($this->service->getTask($task->id)));
        $this->assertCount(1, $this->service->getAllTasks($this->user));

        $updated = $this->service->updateTask($task, [
            'title' => 'Learn Laravel and Angular',
            'status' => 'In Progress',
        ]);
        $this->assertSame('Learn Laravel and Angular', $updated->title);
        $this->assertSame(TaskStatus::InProgress, $updated->status);
        $this->assertSame(TaskPriority::High, $updated->priority);

        $this->assertTrue($this->service->deleteTask($updated));
        $this->assertDatabaseMissing('tasks', ['id' => $task->id]);
    }

    public function test_users_only_get_their_own_tasks(): void
    {
        Task::factory()->count(2)->for($this->user)->create();
        Task::factory()->count(3)->create();

        $this->assertCount(2, $this->service->getAllTasks($this->user));
    }

    public function test_get_task_throws_for_missing_id(): void
    {
        $this->expectException(ModelNotFoundException::class);
        $this->service->getTask(123456);
    }

    public function test_create_without_status_or_priority_uses_defaults(): void
    {
        $task = $this->service->createTask($this->user, ['title' => 'Minimal']);

        $this->assertSame(TaskStatus::Pending, $task->status);
        $this->assertSame(TaskPriority::Medium, $task->priority);
        $this->assertInstanceOf(Task::class, $task);
    }
}
