<?php

namespace Tests\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Mockery;
use Mockery\MockInterface;
use Psr\Log\LoggerInterface;
use Tests\TestCase;

class AuthenticationLoggingTest extends TestCase
{
    use RefreshDatabase;

    private LoggerInterface&MockInterface $security;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withHeaders(['Origin' => 'http://localhost:4200', 'Referer' => 'http://localhost:4200/']);
        $this->security = Mockery::spy(LoggerInterface::class);
        Log::partialMock()->shouldReceive('channel')->with('security')->andReturn($this->security);
    }

    public function test_successful_login_is_logged_without_password(): void
    {
        $user = User::factory()->create(['email' => 'jane@example.com', 'password' => 'Secret123']);

        $this->postJson('/api/login', ['email' => 'jane@example.com', 'password' => 'Secret123'])->assertOk();

        $this->security->shouldHaveReceived('info')->with('Login succeeded', Mockery::on(
            fn (array $ctx) => $ctx['user_id'] === $user->id
                && $ctx['guard'] === 'web'
                && isset($ctx['ip'])
                && ! str_contains(json_encode($ctx), 'Secret123')
        ))->once();
    }

    public function test_failed_login_is_logged_with_masked_email(): void
    {
        User::factory()->create(['email' => 'jane@example.com', 'password' => 'Secret123']);

        $this->postJson('/api/login', ['email' => 'jane@example.com', 'password' => 'wrong-pass'])->assertUnprocessable();

        $this->security->shouldHaveReceived('warning')->with('Login failed', Mockery::on(
            fn (array $ctx) => $ctx['email'] === 'j***@example.com'
                && $ctx['user_exists'] === true
                && ! str_contains(json_encode($ctx), 'wrong-pass')
        ))->once();
    }

    public function test_failed_login_for_unknown_user_is_logged(): void
    {
        $this->postJson('/api/login', ['email' => 'ghost@example.com', 'password' => 'x'])->assertUnprocessable();

        $this->security->shouldHaveReceived('warning')->with('Login failed', Mockery::on(
            fn (array $ctx) => $ctx['user_exists'] === false
        ))->once();
    }

    public function test_registration_and_logout_are_logged(): void
    {
        $this->postJson('/api/register', [
            'name' => 'Jane', 'email' => 'jane@example.com',
            'password' => 'Secret123', 'password_confirmation' => 'Secret123',
        ])->assertCreated();
        $userId = User::where('email', 'jane@example.com')->value('id');

        $this->postJson('/api/logout')->assertOk();

        $this->security->shouldHaveReceived('info')->with('User registered', Mockery::on(fn ($ctx) => $ctx['user_id'] === $userId))->once();
        $this->security->shouldHaveReceived('info')->with('Logout', Mockery::on(fn ($ctx) => $ctx['user_id'] === $userId))->once();
    }
}
