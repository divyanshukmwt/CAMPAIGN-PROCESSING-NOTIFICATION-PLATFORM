<?php

namespace Tests\Unit\Policies;

use App\Models\Task;
use App\Models\User;
use App\Policies\TaskPolicy;
use PHPUnit\Framework\TestCase;

class TaskPolicyTest extends TestCase
{
    private function user(int $id): User
    {
        $user = new User;
        $user->id = $id;

        return $user;
    }

    private function taskOwnedBy(int $userId): Task
    {
        $task = new Task;
        $task->user_id = $userId;

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

    public function test_other_users_are_denied(): void
    {
        $policy = new TaskPolicy;
        $other = $this->user(2);
        $task = $this->taskOwnedBy(1);

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
