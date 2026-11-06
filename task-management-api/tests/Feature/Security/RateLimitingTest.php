<?php

namespace Tests\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Mockery;
use Psr\Log\LoggerInterface;
use Tests\TestCase;

class RateLimitingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withHeaders(['Origin' => 'http://localhost:4200', 'Referer' => 'http://localhost:4200/']);
    }

    public function test_login_is_limited_to_five_attempts_per_minute_per_email_and_ip(): void
    {
        User::factory()->create(['email' => 'jane@example.com', 'password' => 'Secret123']);

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/login', ['email' => 'jane@example.com', 'password' => 'wrong'])
                ->assertUnprocessable();
        }

        $this->postJson('/api/login', ['email' => 'jane@example.com', 'password' => 'Secret123'])
            ->assertTooManyRequests()
            ->assertExactJson(['message' => 'Too many login attempts. Please try again later.'])
            ->assertHeader('Retry-After')
            ->assertHeader('X-RateLimit-Limit', '5');

        $this->assertGuest('web');
    }

    public function test_login_limit_is_per_email_so_other_accounts_are_not_locked_out(): void
    {
        User::factory()->create(['email' => 'other@example.com', 'password' => 'Secret123']);

        for ($i = 0; $i < 6; $i++) {
            $this->postJson('/api/login', ['email' => 'victim@example.com', 'password' => 'wrong']);
        }

        $this->postJson('/api/login', ['email' => 'other@example.com', 'password' => 'Secret123'])->assertOk();
    }

    public function test_login_lockout_is_written_to_the_security_log(): void
    {
        $logger = Mockery::spy(LoggerInterface::class);
        Log::partialMock()->shouldReceive('channel')->with('security')->andReturn($logger);

        for ($i = 0; $i < 6; $i++) {
            $this->postJson('/api/login', ['email' => 'jane@example.com', 'password' => 'wrong']);
        }

        $logger->shouldHaveReceived('warning')
            ->with('Login rate limit exceeded', Mockery::on(fn ($ctx) => $ctx['email'] === 'j***@example.com' && isset($ctx['ip'])))
            ->once();
    }

    public function test_registration_is_limited_per_ip(): void
    {
        config(['services.rate_limits.register' => 2]);

        foreach (['a', 'b'] as $n) {
            $this->postJson('/api/register', [
                'name' => $n, 'email' => "{$n}@example.com",
                'password' => 'Secret123', 'password_confirmation' => 'Secret123',
            ])->assertCreated();
            auth('web')->logout();
        }

        $this->postJson('/api/register', [
            'name' => 'c', 'email' => 'c@example.com',
            'password' => 'Secret123', 'password_confirmation' => 'Secret123',
        ])
            ->assertTooManyRequests()
            ->assertJsonPath('message', 'Too many registration attempts. Please try again later.');

        $this->assertDatabaseMissing('users', ['email' => 'c@example.com']);
    }

    public function test_api_requests_are_limited_per_authenticated_user(): void
    {
        config(['services.rate_limits.api' => 3]);
        $alice = User::factory()->create();
        $bob = User::factory()->create();

        $this->actingAs($alice, 'sanctum');
        for ($i = 0; $i < 3; $i++) {
            $this->getJson('/api/tasks')->assertOk();
        }
        $this->getJson('/api/tasks')->assertTooManyRequests()->assertHeader('Retry-After');

        // Bob has his own bucket.
        $this->actingAs($bob, 'sanctum');
        $this->getJson('/api/tasks')->assertOk();
    }

    public function test_api_responses_include_rate_limit_headers(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum');

        $this->getJson('/api/tasks')
            ->assertOk()
            ->assertHeader('X-RateLimit-Limit', '60')
            ->assertHeader('X-RateLimit-Remaining', '59');
    }
}
