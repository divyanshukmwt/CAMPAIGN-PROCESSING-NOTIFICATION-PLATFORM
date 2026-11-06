<?php

namespace Tests\Feature\Repositories;

use App\Contracts\TaskRepositoryInterface;
use App\Enums\TaskStatus;
use App\Models\Task;
use App\Models\User;
use App\Repositories\TaskRepository;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class TaskRepositoryTest extends TestCase
{
    use RefreshDatabase;

    private TaskRepositoryInterface $repository;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->repository = $this->app->make(TaskRepositoryInterface::class);
        $this->user = User::factory()->create();
    }

    public function test_interface_is_bound_to_eloquent_implementation(): void
    {
        $this->assertInstanceOf(TaskRepository::class, $this->repository);
    }

    public function test_all_for_user_returns_only_own_tasks_newest_first(): void
    {
        $old = Task::factory()->for($this->user)->create(['created_at' => Carbon::parse('2026-01-01')]);
        $new = Task::factory()->for($this->user)->create(['created_at' => Carbon::parse('2026-06-01')]);
        $mid = Task::factory()->for($this->user)->create(['created_at' => Carbon::parse('2026-03-01')]);
        Task::factory()->create(['created_at' => Carbon::parse('2026-12-01')]); // another user's

        $this->assertSame(
            [$new->id, $mid->id, $old->id],
            $this->repository->allForUser($this->user)->pluck('id')->all()
        );
    }

    public function test_all_for_user_filters_by_title(): void
    {
        Task::factory()->for($this->user)->create(['title' => 'Learn Laravel']);
        Task::factory()->for($this->user)->create(['title' => 'Learn Angular']);
        Task::factory()->create(['title' => 'Learn Laravel too']); // another user's

        $this->assertSame(['Learn Laravel'], $this->repository->allForUser($this->user, 'laravel')->pluck('title')->all());
    }

    public function test_find_and_find_or_fail(): void
    {
        $task = Task::factory()->create();

        $this->assertTrue($task->is($this->repository->find($task->id)));
        $this->assertNull($this->repository->find(999999));
        $this->assertTrue($task->is($this->repository->findOrFail($task->id)));

        $this->expectException(ModelNotFoundException::class);
        $this->repository->findOrFail(999999);
    }

    public function test_create_assigns_owner_and_returns_fresh_model_with_defaults(): void
    {
        $task = $this->repository->create($this->user, ['title' => 'Repository create']);

        $this->assertNotNull($task->id);
        $this->assertSame($this->user->id, $task->user_id);
        $this->assertSame(TaskStatus::Pending, $task->status);
        $this->assertDatabaseHas('tasks', ['id' => $task->id, 'title' => 'Repository create', 'user_id' => $this->user->id]);
    }

    public function test_update_changes_only_given_attributes(): void
    {
        $task = Task::factory()->for($this->user)->create(['title' => 'Before', 'priority' => 'Low']);

        $updated = $this->repository->update($task, ['title' => 'After']);

        $this->assertSame('After', $updated->title);
        $this->assertSame('Low', $updated->priority->value);
    }

    public function test_delete_removes_the_record(): void
    {
        $task = Task::factory()->for($this->user)->create();

        $this->assertTrue($this->repository->delete($task));
        $this->assertDatabaseMissing('tasks', ['id' => $task->id]);
    }
}
