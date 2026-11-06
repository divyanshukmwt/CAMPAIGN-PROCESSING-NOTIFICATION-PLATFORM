<?php

namespace Tests\Feature\Auth;

use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TaskAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private User $intruder;

    private Task $task;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::factory()->create();
        $this->intruder = User::factory()->create();
        $this->task = Task::factory()->for($this->owner)->create(['title' => 'Private task']);
    }

    // ---------- Unauthenticated ----------

    public function test_guests_cannot_access_any_task_endpoint(): void
    {
        $id = $this->task->id;

        $this->getJson('/api/tasks')->assertUnauthorized();
        $this->postJson('/api/tasks', ['title' => 'x', 'status' => 'Pending', 'priority' => 'Low'])->assertUnauthorized();
        $this->getJson("/api/tasks/{$id}")->assertUnauthorized();
        $this->putJson("/api/tasks/{$id}", ['title' => 'x'])->assertUnauthorized();
        $this->deleteJson("/api/tasks/{$id}")->assertUnauthorized();

        $this->assertDatabaseHas('tasks', ['id' => $id, 'title' => 'Private task']);
        $this->assertDatabaseCount('tasks', 1);
    }

    // ---------- Another user's task ----------

    public function test_users_cannot_list_other_users_tasks(): void
    {
        $this->actingAs($this->intruder, 'sanctum');

        $this->getJson('/api/tasks')->assertOk()->assertExactJson([]);
        $this->getJson('/api/tasks?search=Private')->assertOk()->assertExactJson([]);
    }

    public function test_users_cannot_view_other_users_task(): void
    {
        $this->actingAs($this->intruder, 'sanctum');

        $this->getJson("/api/tasks/{$this->task->id}")
            ->assertForbidden()
            ->assertJsonPath('message', 'This action is unauthorized.');
    }

    public function test_users_cannot_update_other_users_task_even_with_invalid_data(): void
    {
        $this->actingAs($this->intruder, 'sanctum');

        $this->putJson("/api/tasks/{$this->task->id}", ['title' => 'Hacked'])->assertForbidden();
        // Authorisation runs before validation: no validation details leak.
        $this->putJson("/api/tasks/{$this->task->id}", ['status' => 'Invalid'])->assertForbidden();

        $this->assertDatabaseHas('tasks', ['id' => $this->task->id, 'title' => 'Private task']);
    }

    public function test_users_cannot_delete_other_users_task(): void
    {
        $this->actingAs($this->intruder, 'sanctum');

        $this->deleteJson("/api/tasks/{$this->task->id}")->assertForbidden();

        $this->assertDatabaseHas('tasks', ['id' => $this->task->id]);
    }

    // ---------- Owner ----------

    public function test_owner_has_full_access(): void
    {
        $this->actingAs($this->owner, 'sanctum');
        $id = $this->task->id;

        $this->getJson('/api/tasks')->assertOk()->assertJsonCount(1);
        $this->getJson("/api/tasks/{$id}")->assertOk()->assertJsonPath('title', 'Private task');
        $this->putJson("/api/tasks/{$id}", ['status' => 'Completed'])->assertOk();
        $this->deleteJson("/api/tasks/{$id}")->assertOk();
    }

    public function test_created_task_is_owned_by_the_authenticated_user_and_user_id_cannot_be_spoofed(): void
    {
        $this->actingAs($this->intruder, 'sanctum');

        $id = $this->postJson('/api/tasks', [
            'title' => 'Mine', 'status' => 'Pending', 'priority' => 'Low', 'user_id' => $this->owner->id,
        ])->assertCreated()->json('data.id');

        $this->assertDatabaseHas('tasks', ['id' => $id, 'user_id' => $this->intruder->id]);
    }

    public function test_task_payload_does_not_expose_owner_id(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        $this->getJson("/api/tasks/{$this->task->id}")->assertOk()->assertJsonMissingPath('user_id');
    }
}
