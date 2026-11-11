<?php

declare(strict_types=1);

namespace Tests\Feature\Api;

use App\Enums\UserRole;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TaskAssignmentAndRbacTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $userA;

    private User $userB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->dualRole()->create([
            'name' => 'Admin Boss',
            'email' => 'admin@example.com',
            'password' => 'Secret123',
        ]);
        $this->admin->setActiveRole(UserRole::Admin);

        $this->userA = User::factory()->create([
            'name' => 'Alice User',
            'email' => 'alice@example.com',
            'password' => 'Secret123',
        ]);

        $this->userB = User::factory()->create([
            'name' => 'Bob User',
            'email' => 'bob@example.com',
            'password' => 'Secret123',
        ]);
    }

    public function test_admin_can_create_task_and_assign_to_user_with_full_attribution(): void
    {
        $this->actingAs($this->admin, 'sanctum');

        $response = $this->postJson('/api/tasks', [
            'title' => 'Quarterly Audit Review',
            'description' => 'Complete compliance check',
            'status' => 'Pending',
            'priority' => 'High',
            'due_date' => '2026-12-15',
            'assigned_to_user_id' => $this->userA->id,
        ]);

        $response->assertCreated()
            ->assertJsonPath('message', 'Task created successfully')
            ->assertJsonPath('data.created_by.id', $this->admin->id)
            ->assertJsonPath('data.created_by.name', 'Admin Boss')
            ->assertJsonPath('data.assigned_by.id', $this->admin->id)
            ->assertJsonPath('data.assigned_by.name', 'Admin Boss')
            ->assertJsonPath('data.assigned_to.id', $this->userA->id)
            ->assertJsonPath('data.assigned_to.name', 'Alice User');

        // Alice (userA) sees the task assigned to her in her task list
        $this->actingAs($this->userA, 'sanctum');
        $this->getJson('/api/tasks')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.title', 'Quarterly Audit Review')
            ->assertJsonPath('0.created_by.name', 'Admin Boss')
            ->assertJsonPath('0.assigned_by.name', 'Admin Boss')
            ->assertJsonPath('0.assigned_to.name', 'Alice User');
    }

    public function test_user_creates_task_and_admin_reassigns_it_to_another_user(): void
    {
        // Alice creates a task as a standard user
        $this->actingAs($this->userA, 'sanctum');

        $createResponse = $this->postJson('/api/tasks', [
            'title' => 'User Created Task',
            'status' => 'Pending',
            'priority' => 'Medium',
        ])->assertCreated();

        $taskId = $createResponse->json('data.id');
        $createResponse
            ->assertJsonPath('data.created_by.id', $this->userA->id)
            ->assertJsonPath('data.assigned_by.id', $this->userA->id)
            ->assertJsonPath('data.assigned_to.id', $this->userA->id);

        // Admin reassigns Alice's task to Bob (userB)
        $this->actingAs($this->admin, 'sanctum');

        $this->putJson("/api/tasks/{$taskId}", [
            'assigned_to_user_id' => $this->userB->id,
            'priority' => 'High',
        ])
            ->assertOk()
            ->assertJsonPath('data.created_by.id', $this->userA->id)
            ->assertJsonPath('data.created_by.name', 'Alice User')
            ->assertJsonPath('data.assigned_by.id', $this->admin->id)
            ->assertJsonPath('data.assigned_by.name', 'Admin Boss')
            ->assertJsonPath('data.assigned_to.id', $this->userB->id)
            ->assertJsonPath('data.assigned_to.name', 'Bob User');

        // Bob can now view and update the status of the task assigned to him
        $this->actingAs($this->userB, 'sanctum');
        $this->getJson('/api/tasks')->assertOk()->assertJsonCount(1);
        $this->putJson("/api/tasks/{$taskId}", ['status' => 'In Progress'])
            ->assertOk()
            ->assertJsonPath('data.status', 'In Progress');
    }

    public function test_standard_user_cannot_assign_or_reassign_task_to_another_user(): void
    {
        $this->actingAs($this->userA, 'sanctum');

        // Attempting to create a task assigned to Bob is forbidden (403)
        $this->postJson('/api/tasks', [
            'title' => 'Unauthorized Assignment',
            'status' => 'Pending',
            'priority' => 'Low',
            'assigned_to_user_id' => $this->userB->id,
        ])->assertForbidden();

        // Attempting to reassign own task to Bob is also forbidden (403)
        $task = Task::factory()->for($this->userA)->create();
        $this->putJson("/api/tasks/{$task->id}", [
            'assigned_to_user_id' => $this->userB->id,
        ])->assertForbidden();
    }

    public function test_admin_can_list_all_users_and_filter_tasks_by_user(): void
    {
        $taskA = Task::factory()->for($this->userA)->create(['title' => 'Alice Task']);
        $taskB = Task::factory()->for($this->userB)->create(['title' => 'Bob Task']);

        $this->actingAs($this->admin, 'sanctum');

        // Admin can fetch user directory
        $this->getJson('/api/users')
            ->assertOk()
            ->assertJsonCount(3);

        // Admin sees all tasks across users
        $this->getJson('/api/tasks')
            ->assertOk()
            ->assertJsonCount(2);

        // Admin filters tasks by Alice's user_id
        $this->getJson("/api/tasks?user_id={$this->userA->id}")
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.id', $taskA->id);

        // Standard user is denied access to GET /api/users
        $this->actingAs($this->userA, 'sanctum');
        $this->getJson('/api/users')->assertForbidden();
    }

    public function test_dual_role_account_switching_role_changes_task_visibility_and_permissions(): void
    {
        Task::factory()->for($this->userA)->create(['title' => 'Alice Private Task']);

        // Log in with dual-role account as "user" first
        $this->withHeaders([
            'Origin' => 'http://localhost:4200',
            'Referer' => 'http://localhost:4200/',
        ]);

        $this->postJson('/api/login', [
            'email' => $this->admin->email,
            'password' => 'Secret123',
            'role' => 'user',
        ])->assertOk();

        // While acting as "user", does not see Alice's task and cannot access /api/users
        $this->getJson('/api/tasks')->assertOk()->assertExactJson([]);
        $this->getJson('/api/users')->assertForbidden();

        // Switch role to "admin"
        $this->postJson('/api/auth/switch-role', ['role' => 'admin'])->assertOk();

        // Now acting as "admin": sees Alice's task and can access /api/users
        $this->getJson('/api/tasks')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.title', 'Alice Private Task');
        $this->getJson('/api/users')->assertOk()->assertJsonCount(3);
    }
}
