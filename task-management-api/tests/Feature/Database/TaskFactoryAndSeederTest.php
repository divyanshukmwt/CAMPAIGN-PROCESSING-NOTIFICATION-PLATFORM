<?php

namespace Tests\Feature\Database;

use App\Enums\TaskPriority;
use App\Enums\TaskStatus;
use App\Models\Task;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\TaskSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TaskFactoryAndSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_factory_creates_valid_tasks(): void
    {
        $tasks = Task::factory()->count(20)->create();

        $this->assertCount(20, $tasks);
        foreach ($tasks as $task) {
            $this->assertNotEmpty($task->title);
            $this->assertLessThanOrEqual(255, strlen($task->title));
            $this->assertInstanceOf(TaskStatus::class, $task->fresh()->status);
            $this->assertInstanceOf(TaskPriority::class, $task->fresh()->priority);
        }
    }

    public function test_factory_states(): void
    {
        $this->assertSame(TaskStatus::Pending, Task::factory()->pending()->create()->status);
        $this->assertSame(TaskStatus::InProgress, Task::factory()->inProgress()->create()->status);
        $this->assertSame(TaskStatus::Completed, Task::factory()->completed()->create()->status);
        $this->assertSame(TaskPriority::High, Task::factory()->priority(TaskPriority::High)->create()->priority);
    }

    public function test_task_seeder_creates_sample_tasks_including_the_reference_example(): void
    {
        $this->seed(TaskSeeder::class);

        $this->assertSame(10, Task::count());
        $this->assertDatabaseHas('tasks', [
            'title' => 'Learn Laravel',
            'status' => 'Pending',
            'priority' => 'High',
            'due_date' => '2026-12-31',
        ]);
    }

    public function test_database_seeder_can_run_twice_without_errors(): void
    {
        $this->seed(DatabaseSeeder::class);
        $this->seed(DatabaseSeeder::class);

        $this->assertDatabaseCount('users', 1);
        $this->assertSame(1, Task::where('title', 'Learn Laravel')->count());
    }
}
