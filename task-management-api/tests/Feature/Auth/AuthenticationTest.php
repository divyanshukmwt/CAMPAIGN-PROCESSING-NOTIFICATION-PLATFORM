<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Simulate requests coming from the Angular SPA (a Sanctum stateful domain).
        $this->withHeaders([
            'Origin' => 'http://localhost:4200',
            'Referer' => 'http://localhost:4200/',
        ]);
    }

    private function registrationPayload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Jane Doe',
            'email' => 'jane@example.com',
            'password' => 'Secret123',
            'password_confirmation' => 'Secret123',
        ], $overrides);
    }

    // ---------- Register ----------

    public function test_user_can_register_and_is_logged_in(): void
    {
        $this->postJson('/api/register', $this->registrationPayload())
            ->assertCreated()
            ->assertJsonPath('message', 'Registration successful')
            ->assertJsonPath('user.email', 'jane@example.com')
            ->assertJsonMissingPath('user.password');

        $user = User::where('email', 'jane@example.com')->firstOrFail();
        $this->assertTrue(Hash::check('Secret123', $user->password), 'Password must be hashed');
        $this->assertNotSame('Secret123', $user->password);
        $this->assertAuthenticatedAs($user, 'web');
    }

    public function test_email_is_normalised_to_lowercase(): void
    {
        $this->postJson('/api/register', $this->registrationPayload(['email' => '  Jane@Example.COM ']))
            ->assertCreated()
            ->assertJsonPath('user.email', 'jane@example.com');
    }

    public function test_registration_validation_errors(): void
    {
        User::factory()->create(['email' => 'taken@example.com']);

        $this->postJson('/api/register', [
            'name' => '',
            'email' => 'taken@example.com',
            'password' => 'short',
            'password_confirmation' => 'different',
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name', 'email', 'password']);
    }

    public function test_password_must_contain_letters_and_numbers(): void
    {
        $this->postJson('/api/register', $this->registrationPayload([
            'password' => 'onlyletters', 'password_confirmation' => 'onlyletters',
        ]))->assertUnprocessable()->assertJsonValidationErrors(['password']);
    }

    // ---------- Login ----------

    public function test_user_can_login_with_valid_credentials(): void
    {
        $user = User::factory()->create(['email' => 'john@example.com', 'password' => 'Secret123']);

        $this->postJson('/api/login', ['email' => 'John@Example.com', 'password' => 'Secret123'])
            ->assertOk()
            ->assertJsonPath('message', 'Login successful')
            ->assertJsonPath('user.id', $user->id)
            ->assertJsonMissingPath('user.password');

        $this->assertAuthenticatedAs($user, 'web');
    }

    public function test_login_fails_with_wrong_password(): void
    {
        User::factory()->create(['email' => 'john@example.com', 'password' => 'Secret123']);

        $this->postJson('/api/login', ['email' => 'john@example.com', 'password' => 'wrong-password'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email'])
            ->assertJsonPath('errors.email.0', 'These credentials do not match our records.');

        $this->assertGuest('web');
    }

    public function test_login_fails_for_unknown_email_with_same_message(): void
    {
        $this->postJson('/api/login', ['email' => 'nobody@example.com', 'password' => 'Secret123'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.email.0', 'These credentials do not match our records.');
    }

    public function test_login_requires_email_and_password(): void
    {
        $this->postJson('/api/login', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email', 'password']);
    }

    // ---------- Current user ----------

    public function test_authenticated_user_can_fetch_profile(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user, 'web')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJson(['id' => $user->id, 'email' => $user->email])
            ->assertJsonMissingPath('password')
            ->assertJsonMissingPath('remember_token');
    }

    public function test_guest_cannot_fetch_profile(): void
    {
        $this->getJson('/api/user')->assertUnauthorized()->assertJson(['message' => 'Unauthenticated.']);
    }

    // ---------- Logout ----------

    public function test_user_can_logout(): void
    {
        $user = User::factory()->create(['password' => 'Secret123']);
        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'Secret123'])->assertOk();

        $this->postJson('/api/logout')
            ->assertOk()
            ->assertExactJson(['message' => 'Logged out successfully']);

        $this->assertGuest('web');
        Auth::forgetGuards();
        $this->getJson('/api/user')->assertUnauthorized();
    }

    public function test_guest_cannot_logout(): void
    {
        $this->postJson('/api/logout')->assertUnauthorized();
    }

    // ---------- Full SPA flow ----------

    public function test_full_spa_flow_csrf_cookie_register_profile_logout(): void
    {
        $this->get('/sanctum/csrf-cookie')->assertNoContent()->assertCookie('XSRF-TOKEN');

        $this->postJson('/api/register', $this->registrationPayload())->assertCreated();
        $this->getJson('/api/user')->assertOk()->assertJsonPath('email', 'jane@example.com');

        $this->postJson('/api/logout')->assertOk();
        Auth::forgetGuards();
        $this->getJson('/api/user')->assertUnauthorized();
    }
}
