<?php

namespace Tests\Feature\Database;

use App\Enums\TaskPriority;
use App\Enums\TaskStatus;
use App\Models\Task;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\TaskSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class TaskFactoryAndSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_factory_creates_valid_owned_tasks(): void
    {
        $tasks = Task::factory()->count(20)->create();

        $this->assertCount(20, $tasks);
        foreach ($tasks as $task) {
            $this->assertNotEmpty($task->title);
            $this->assertLessThanOrEqual(255, strlen($task->title));
            $this->assertNotNull($task->user_id);
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

    public function test_task_seeder_creates_sample_tasks_owned_by_the_demo_user(): void
    {
        $this->seed(TaskSeeder::class);

        $demo = User::where('email', DatabaseSeeder::DEMO_EMAIL)->firstOrFail();
        $this->assertSame(10, $demo->tasks()->count());
        $this->assertDatabaseHas('tasks', [
            'user_id' => $demo->id,
            'title' => 'Learn Laravel',
            'status' => 'Pending',
            'priority' => 'High',
            'due_date' => '2026-12-31',
        ]);
    }

    public function test_database_seeder_creates_demo_user_and_can_run_twice(): void
    {
        $this->seed(DatabaseSeeder::class);
        $this->seed(DatabaseSeeder::class);

        $this->assertDatabaseCount('users', 1);
        $demo = User::firstOrFail();
        $this->assertTrue(Hash::check(DatabaseSeeder::DEMO_PASSWORD, $demo->password));
        $this->assertSame(1, Task::where('title', 'Learn Laravel')->count());
    }
}
