<?php

namespace Tests\Feature\Api;

use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class TaskApiTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user, 'sanctum');
    }

    private function referencePayload(): array
    {
        return [
            'title' => 'Learn Laravel',
            'description' => 'Understand Laravel API development',
            'status' => 'Pending',
            'priority' => 'High',
            'due_date' => '2026-12-31',
        ];
    }

    // ---------- GET /api/tasks ----------

    public function test_index_returns_plain_array_of_tasks_newest_first(): void
    {
        $old = Task::factory()->for($this->user)->create(['created_at' => Carbon::parse('2026-01-01')]);
        $new = Task::factory()->for($this->user)->create(['created_at' => Carbon::parse('2026-05-01')]);

        $response = $this->getJson('/api/tasks')->assertOk()->assertJsonCount(2);

        $this->assertTrue(array_is_list($response->json()));
        $this->assertSame([$new->id, $old->id], array_column($response->json(), 'id'));
        $response->assertJsonStructure([
            ['id', 'title', 'description', 'status', 'priority', 'due_date', 'created_at', 'updated_at'],
        ]);
    }

    public function test_index_returns_empty_array_when_no_tasks(): void
    {
        $this->getJson('/api/tasks')->assertOk()->assertExactJson([]);
    }

    // ---------- POST /api/tasks ----------

    public function test_store_creates_task_and_returns_documented_response(): void
    {
        $this->postJson('/api/tasks', $this->referencePayload())
            ->assertCreated()
            ->assertJsonPath('message', 'Task created successfully')
            ->assertJsonPath('data.title', 'Learn Laravel')
            ->assertJsonPath('data.description', 'Understand Laravel API development')
            ->assertJsonPath('data.status', 'Pending')
            ->assertJsonPath('data.priority', 'High')
            ->assertJsonPath('data.due_date', '2026-12-31')
            ->assertJsonStructure(['message', 'data' => ['id']]);

        $this->assertDatabaseHas('tasks', $this->referencePayload());
    }

    public function test_store_rejects_invalid_input_with_422_and_field_errors(): void
    {
        $this->postJson('/api/tasks', ['title' => '', 'status' => 'Done', 'priority' => 'Urgent', 'due_date' => 'x'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['title', 'status', 'priority', 'due_date']);

        $this->assertDatabaseCount('tasks', 0);
    }

    public function test_store_ignores_non_fillable_fields(): void
    {
        $response = $this->postJson('/api/tasks', $this->referencePayload() + ['id' => 777, 'created_at' => '2000-01-01'])
            ->assertCreated();

        $this->assertNotSame(777, $response->json('data.id'));
        $this->assertStringStartsNotWith('2000', $response->json('data.created_at'));
    }

    // ---------- GET /api/tasks/{id} ----------

    public function test_show_returns_single_task_object(): void
    {
        $task = Task::factory()->for($this->user)->create(['title' => 'Show me']);

        $this->getJson("/api/tasks/{$task->id}")
            ->assertOk()
            ->assertJsonPath('id', $task->id)
            ->assertJsonPath('title', 'Show me')
            ->assertJsonMissingPath('data');
    }

    public function test_show_returns_404_for_missing_task(): void
    {
        $this->getJson('/api/tasks/999999')->assertNotFound();
    }

    // ---------- PUT /api/tasks/{id} ----------

    public function test_update_with_documented_partial_payload(): void
    {
        $task = Task::factory()->for($this->user)->create($this->referencePayload());

        $this->putJson("/api/tasks/{$task->id}", [
            'title' => 'Learn Laravel and Angular',
            'status' => 'In Progress',
            'priority' => 'High',
        ])
            ->assertOk()
            ->assertJsonPath('message', 'Task updated successfully')
            ->assertJsonPath('data.title', 'Learn Laravel and Angular')
            ->assertJsonPath('data.status', 'In Progress')
            ->assertJsonPath('data.description', 'Understand Laravel API development')
            ->assertJsonPath('data.due_date', '2026-12-31');

        $this->assertDatabaseHas('tasks', ['id' => $task->id, 'status' => 'In Progress']);
    }

    public function test_patch_is_also_supported(): void
    {
        $task = Task::factory()->for($this->user)->create(['priority' => 'Low']);

        $this->patchJson("/api/tasks/{$task->id}", ['priority' => 'High'])
            ->assertOk()
            ->assertJsonPath('data.priority', 'High');
    }

    public function test_update_can_clear_optional_fields(): void
    {
        $task = Task::factory()->for($this->user)->create(['description' => 'Text', 'due_date' => '2026-12-31']);

        $this->putJson("/api/tasks/{$task->id}", ['description' => null, 'due_date' => null])
            ->assertOk()
            ->assertJsonPath('data.description', null)
            ->assertJsonPath('data.due_date', null);
    }

    public function test_update_rejects_invalid_input(): void
    {
        $task = Task::factory()->for($this->user)->create(['title' => 'Unchanged']);

        $this->putJson("/api/tasks/{$task->id}", ['title' => '', 'status' => 'Done'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['title', 'status']);

        $this->assertDatabaseHas('tasks', ['id' => $task->id, 'title' => 'Unchanged']);
    }

    public function test_update_returns_404_for_missing_task(): void
    {
        $this->putJson('/api/tasks/999999', ['title' => 'x'])->assertNotFound();
    }

    // ---------- DELETE /api/tasks/{id} ----------

    public function test_destroy_deletes_task_and_returns_message(): void
    {
        $task = Task::factory()->for($this->user)->create();

        $this->deleteJson("/api/tasks/{$task->id}")
            ->assertOk()
            ->assertExactJson(['message' => 'Task deleted successfully']);

        $this->assertDatabaseMissing('tasks', ['id' => $task->id]);
    }

    public function test_destroy_returns_404_for_missing_task(): void
    {
        $this->deleteJson('/api/tasks/999999')->assertNotFound();
    }

    // ---------- Routing ----------

    public function test_five_rest_endpoints_are_registered(): void
    {
        $routes = collect(app('router')->getRoutes()->getRoutes())
            ->filter(fn ($r) => str_starts_with($r->uri(), 'api/tasks'))
            ->map(fn ($r) => implode('|', array_diff($r->methods(), ['HEAD'])).' '.$r->uri())
            ->values()->all();

        $this->assertEqualsCanonicalizing([
            'GET api/tasks',
            'POST api/tasks',
            'GET api/tasks/{task}',
            'PUT|PATCH api/tasks/{task}',
            'DELETE api/tasks/{task}',
        ], $routes);
    }
}
