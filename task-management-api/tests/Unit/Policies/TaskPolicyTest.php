<?php

namespace Tests\Unit\Policies;

use App\Enums\UserRole;
use App\Models\Task;
use App\Models\User;
use App\Policies\TaskPolicy;
use PHPUnit\Framework\TestCase;

class TaskPolicyTest extends TestCase
{
    private function user(int $id, bool $actingAsAdmin = false): User
    {
        $user = new User;
        $user->id = $id;
        if ($actingAsAdmin) {
            $user->forceFill(['roles' => [UserRole::Admin->value, UserRole::User->value]]);
            $user->setActiveRole(UserRole::Admin);
        }

        return $user;
    }

    private function taskOwnedBy(int $userId, ?int $assignedToId = null): Task
    {
        $task = new Task;
        $task->user_id = $userId;
        $task->assigned_to_user_id = $assignedToId ?? $userId;

        return $task;
    }

    public function test_owner_can_view_update_and_delete(): void
    {
        $policy = new TaskPolicy;
        $owner = $this->user(1);
        $task = $this->taskOwnedBy(1);

        $this->assertTrue($policy->view($owner, $task));
        $this->assertTrue($policy->update($owner, $task));
        $this->assertTrue($policy->delete($owner, $task));
    }

    public function test_assignee_can_view_and_update_but_not_delete(): void
    {
        $policy = new TaskPolicy;
        $assignee = $this->user(2);
        $task = $this->taskOwnedBy(1, 2);

        $this->assertTrue($policy->view($assignee, $task));
        $this->assertTrue($policy->update($assignee, $task));
        $this->assertFalse($policy->delete($assignee, $task));
    }

    public function test_active_admin_can_view_update_assign_and_delete_any_task(): void
    {
        $policy = new TaskPolicy;
        $admin = $this->user(99, true);
        $task = $this->taskOwnedBy(1, 2);

        $this->assertTrue($policy->assign($admin));
        $this->assertTrue($policy->view($admin, $task));
        $this->assertTrue($policy->update($admin, $task));
        $this->assertTrue($policy->delete($admin, $task));
    }

    public function test_other_users_are_denied(): void
    {
        $policy = new TaskPolicy;
        $other = $this->user(2);
        $task = $this->taskOwnedBy(1);

        $this->assertFalse($policy->assign($other));
        $this->assertFalse($policy->view($other, $task));
        $this->assertFalse($policy->update($other, $task));
        $this->assertFalse($policy->delete($other, $task));
    }

    public function test_any_authenticated_user_can_list_and_create(): void
    {
        $policy = new TaskPolicy;

        $this->assertTrue($policy->viewAny($this->user(3)));
        $this->assertTrue($policy->create($this->user(3)));
    }
}
