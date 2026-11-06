<?php

namespace Tests\Feature\Models;

use App\Enums\TaskPriority;
use App\Enums\TaskStatus;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TaskModelTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
    }

    public function test_task_can_be_mass_assigned_and_persisted_through_its_owner(): void
    {
        $task = $this->user->tasks()->create([
            'title' => 'Learn Laravel',
            'description' => 'Complete Laravel training',
            'status' => 'Pending',
            'priority' => 'High',
            'due_date' => '2026-12-31',
        ]);

        $this->assertDatabaseHas('tasks', [
            'id' => $task->id,
            'user_id' => $this->user->id,
            'title' => 'Learn Laravel',
            'status' => 'Pending',
            'priority' => 'High',
            'due_date' => '2026-12-31',
        ]);
    }

    public function test_status_and_priority_are_cast_to_enums(): void
    {
        $task = $this->user->tasks()->create(['title' => 'Cast check', 'status' => 'In Progress', 'priority' => 'Low']);
        $fresh = $task->fresh();

        $this->assertSame(TaskStatus::InProgress, $fresh->status);
        $this->assertSame(TaskPriority::Low, $fresh->priority);
    }

    public function test_defaults_are_applied_when_not_provided(): void
    {
        $task = $this->user->tasks()->create(['title' => 'Defaults']);

        $this->assertSame(TaskStatus::Pending, $task->status);
        $this->assertSame(TaskPriority::Medium, $task->priority);
        $this->assertSame(TaskStatus::Pending, $task->fresh()->status);
    }

    public function test_json_serialisation_uses_plain_values_and_y_m_d_due_date(): void
    {
        $task = $this->user->tasks()->create([
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

    public function test_id_and_user_id_are_not_mass_assignable(): void
    {
        $other = User::factory()->create();
        $task = $this->user->tasks()->create(['title' => 'Guarded', 'id' => 9999, 'user_id' => $other->id]);

        $this->assertNotSame(9999, $task->id);
        $this->assertSame($this->user->id, $task->user_id);
        $this->assertSame(
            ['title', 'description', 'status', 'priority', 'due_date'],
            $task->getFillable()
        );
    }

    public function test_relationships_between_user_and_tasks(): void
    {
        $task = Task::factory()->for($this->user)->create();

        $this->assertTrue($task->user->is($this->user));
        $this->assertTrue($this->user->tasks->contains($task));
    }

    public function test_deleting_a_user_deletes_their_tasks(): void
    {
        $task = Task::factory()->for($this->user)->create();

        $this->user->delete();

        $this->assertDatabaseMissing('tasks', ['id' => $task->id]);
    }
}
