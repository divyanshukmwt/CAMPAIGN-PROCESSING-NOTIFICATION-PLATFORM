<?php

namespace Tests\Feature\Models;

use App\Enums\TaskPriority;
use App\Enums\TaskStatus;
use App\Models\Task;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TaskModelTest extends TestCase
{
    use RefreshDatabase;

    public function test_task_can_be_mass_assigned_and_persisted(): void
    {
        $task = Task::create([
            'title' => 'Learn Laravel',
            'description' => 'Complete Laravel training',
            'status' => 'Pending',
            'priority' => 'High',
            'due_date' => '2026-12-31',
        ]);

        $this->assertDatabaseHas('tasks', [
            'id' => $task->id,
            'title' => 'Learn Laravel',
            'status' => 'Pending',
            'priority' => 'High',
            'due_date' => '2026-12-31',
        ]);
    }

    public function test_status_and_priority_are_cast_to_enums(): void
    {
        $task = Task::create(['title' => 'Cast check', 'status' => 'In Progress', 'priority' => 'Low']);
        $fresh = $task->fresh();

        $this->assertSame(TaskStatus::InProgress, $fresh->status);
        $this->assertSame(TaskPriority::Low, $fresh->priority);
    }

    public function test_defaults_are_applied_when_not_provided(): void
    {
        $task = Task::create(['title' => 'Defaults']);

        $this->assertSame(TaskStatus::Pending, $task->status);
        $this->assertSame(TaskPriority::Medium, $task->priority);
        $this->assertSame(TaskStatus::Pending, $task->fresh()->status);
    }

    public function test_json_serialisation_uses_plain_values_and_y_m_d_due_date(): void
    {
        $task = Task::create([
            'title' => 'JSON',
            'status' => TaskStatus::Completed,
            'priority' => TaskPriority::High,
            'due_date' => '2026-12-31',
        ]);

        $json = $task->fresh()->toArray();

        $this->assertSame('Completed', $json['status']);
        $this->assertSame('High', $json['priority']);
        $this->assertSame('2026-12-31', $json['due_date']);
    }

    public function test_non_fillable_attributes_are_not_mass_assignable(): void
    {
        $task = Task::create(['title' => 'Guarded', 'id' => 9999]);

        $this->assertNotSame(9999, $task->id);
        $this->assertSame(
            ['title', 'description', 'status', 'priority', 'due_date'],
            $task->getFillable()
        );
    }
}
