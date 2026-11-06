<?php

namespace Tests\Feature\Api;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use RuntimeException;
use Tests\TestCase;

class ApiErrorHandlingTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user, 'sanctum');
    }

    public function test_missing_task_returns_json_404_without_leaking_model_class(): void
    {
        $response = $this->getJson('/api/tasks/999999')
            ->assertNotFound()
            ->assertExactJson(['message' => 'Task not found.']);

        $this->assertStringNotContainsString('App\\Models', $response->getContent());
    }

    public function test_non_numeric_task_id_returns_json_404(): void
    {
        $this->getJson('/api/tasks/abc')->assertNotFound()->assertJsonPath('message', 'Task not found.');
    }

    public function test_unknown_api_route_returns_generic_json_404(): void
    {
        $this->get('/api/unknown-endpoint')
            ->assertNotFound()
            ->assertHeader('Content-Type', 'application/json')
            ->assertExactJson(['message' => 'The requested resource was not found.']);
    }

    public function test_wrong_http_method_returns_json_405_with_allow_header(): void
    {
        $this->postJson('/api/health')
            ->assertStatus(405)
            ->assertJsonPath('message', 'The HTTP method is not allowed for this endpoint.')
            ->assertHeader('Allow');
    }

    public function test_validation_errors_use_standard_json_shape(): void
    {
        $this->postJson('/api/tasks', [])
            ->assertUnprocessable()
            ->assertJsonStructure(['message', 'errors' => ['title', 'status', 'priority']]);
    }

    public function test_validation_errors_are_json_even_without_accept_header(): void
    {
        $this->post('/api/tasks', [])
            ->assertUnprocessable()
            ->assertHeader('Content-Type', 'application/json')
            ->assertJsonStructure(['message', 'errors']);
    }

    public function test_unexpected_errors_return_generic_500_when_debug_is_off(): void
    {
        config(['app.debug' => false]);
        Route::get('/api/_test/explode', fn () => throw new RuntimeException('secret internal detail'));

        $response = $this->getJson('/api/_test/explode')
            ->assertStatus(500)
            ->assertExactJson(['message' => 'An unexpected error occurred. Please try again later.']);

        $this->assertStringNotContainsString('secret internal detail', $response->getContent());
    }

    public function test_unexpected_errors_include_details_when_debug_is_on(): void
    {
        config(['app.debug' => true]);
        Route::get('/api/_test/explode', fn () => throw new RuntimeException('debug detail'));

        $this->getJson('/api/_test/explode')
            ->assertStatus(500)
            ->assertJsonPath('message', 'debug detail');
    }
}
