<?php

namespace Tests\Feature\Api;

use App\Models\Task;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TaskSearchTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Task::factory()->create(['title' => 'Learn Laravel']);
        Task::factory()->create(['title' => 'Learn Angular']);
        Task::factory()->create(['title' => 'Configure MySQL']);
        Task::factory()->create(['title' => '100% coverage_goal']);
    }

    /**
     * @return list<string>
     */
    private function titlesFor(string $query): array
    {
        $response = $this->getJson('/api/tasks?'.http_build_query(['search' => $query]))->assertOk();

        return collect($response->json())->pluck('title')->sort()->values()->all();
    }

    public function test_search_filters_by_partial_title(): void
    {
        $this->assertSame(['Learn Angular', 'Learn Laravel'], $this->titlesFor('Learn'));
        $this->assertSame(['Configure MySQL'], $this->titlesFor('mysql'));
    }

    public function test_search_is_case_insensitive(): void
    {
        $this->assertSame(['Learn Laravel'], $this->titlesFor('LARAVEL'));
    }

    public function test_search_with_no_matches_returns_empty_array(): void
    {
        $this->getJson('/api/tasks?search=nothing-matches')->assertOk()->assertExactJson([]);
    }

    public function test_blank_search_returns_all_tasks(): void
    {
        $this->getJson('/api/tasks?search=')->assertOk()->assertJsonCount(4);
        $this->getJson('/api/tasks?search=%20%20')->assertOk()->assertJsonCount(4);
    }

    public function test_like_wildcards_are_matched_literally(): void
    {
        $this->assertSame([], $this->titlesFor('%%%'));
        $this->assertSame(['100% coverage_goal'], $this->titlesFor('100%'));
        $this->assertSame(['100% coverage_goal'], $this->titlesFor('coverage_'));
        $this->assertSame([], $this->titlesFor('_'.'earn'));
    }

    public function test_sql_injection_attempt_is_treated_as_plain_text(): void
    {
        $this->assertSame([], $this->titlesFor("' OR 1=1 --"));
        $this->assertDatabaseCount('tasks', 4);
    }

    public function test_search_term_longer_than_255_characters_is_rejected(): void
    {
        $this->getJson('/api/tasks?search='.str_repeat('a', 256))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['search']);
    }

    public function test_search_must_be_a_string(): void
    {
        $this->getJson('/api/tasks?search[]=x')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['search']);
    }
}
