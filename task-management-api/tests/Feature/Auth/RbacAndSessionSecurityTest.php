<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Tests\TestCase;

class RbacAndSessionSecurityTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withHeaders([
            'Origin' => 'http://localhost:4200',
            'Referer' => 'http://localhost:4200/',
            'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0',
        ]);
    }

    public function test_dual_role_user_can_login_as_admin_or_user(): void
    {
        $user = User::factory()->dualRole()->create([
            'email' => 'dual@example.com',
            'password' => 'Secret123',
        ]);

        $response = $this->postJson('/api/login', [
            'email' => 'dual@example.com',
            'password' => 'Secret123',
            'role' => 'admin',
        ]);

        $response->assertOk()
            ->assertJsonPath('user.id', $user->id)
            ->assertJsonPath('user.roles', ['admin', 'user'])
            ->assertJsonPath('user.active_role', 'admin')
            ->assertHeader('X-Tab-Token');

        $this->assertSame(64, strlen((string) $response->json('tab_token')));

        $this->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('active_role', 'admin');
    }

    public function test_standard_user_cannot_login_with_admin_role(): void
    {
        User::factory()->create([
            'email' => 'member@example.com',
            'password' => 'Secret123',
            'roles' => [UserRole::User->value],
        ]);

        $this->postJson('/api/login', [
            'email' => 'member@example.com',
            'password' => 'Secret123',
            'role' => 'admin',
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['role'])
            ->assertJsonPath('errors.role.0', 'You do not have permission to sign in with the selected role.');

        $this->assertGuest('web');
    }

    public function test_dual_role_user_can_switch_between_admin_and_user_roles(): void
    {
        $user = User::factory()->dualRole()->create([
            'email' => 'switcher@example.com',
            'password' => 'Secret123',
        ]);

        $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'Secret123',
            'role' => 'user',
        ])->assertOk()->assertJsonPath('user.active_role', 'user');

        $this->postJson('/api/auth/switch-role', ['role' => 'admin'])
            ->assertOk()
            ->assertJsonPath('message', 'Role switched successfully')
            ->assertJsonPath('user.active_role', 'admin');

        $this->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('active_role', 'admin');

        $this->postJson('/api/auth/switch-role', ['role' => 'user'])
            ->assertOk()
            ->assertJsonPath('user.active_role', 'user');
    }

    public function test_standard_user_cannot_switch_to_admin_role(): void
    {
        $user = User::factory()->create([
            'password' => 'Secret123',
            'roles' => [UserRole::User->value],
        ]);

        $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'Secret123',
            'role' => 'user',
        ])->assertOk();

        $this->postJson('/api/auth/switch-role', ['role' => 'admin'])
            ->assertForbidden()
            ->assertJsonPath('message', 'You do not have permission to switch to the requested role.');
    }

    public function test_roles_attribute_is_protected_against_mass_assignment(): void
    {
        $user = User::create([
            'name' => 'Regular User',
            'email' => 'regular@example.com',
            'password' => 'Secret123',
            'roles' => ['admin'],
        ]);

        $this->assertSame(['user'], $user->roleValues());
        $this->assertFalse($user->hasRole(UserRole::Admin));
    }

    public function test_single_tab_token_blocks_mismatched_or_duplicate_tab_requests(): void
    {
        $user = User::factory()->create(['password' => 'Secret123']);

        $loginResponse = $this->withHeaders(['X-Tab-Id' => 'tab-primary-1'])
            ->postJson('/api/login', [
                'email' => $user->email,
                'password' => 'Secret123',
            ])
            ->assertOk();

        $tabToken = (string) $loginResponse->json('tab_token');

        // Primary tab with matching X-Tab-Token succeeds
        $this->withHeaders(['X-Tab-Token' => $tabToken])
            ->getJson('/api/user')
            ->assertOk();

        // Duplicate tab with wrong X-Tab-Token is blocked with 409 TAB_CONFLICT
        $this->withHeaders(['X-Tab-Token' => 'invalid-duplicate-tab-token'])
            ->getJson('/api/user')
            ->assertStatus(409)
            ->assertJsonPath('code', 'TAB_CONFLICT');
    }

    public function test_user_agent_fingerprint_mismatch_terminates_session(): void
    {
        $user = User::factory()->create(['password' => 'Secret123']);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'Secret123',
        ])->assertOk();

        $tabToken = (string) $loginResponse->json('tab_token');

        // Replay session from a different browser User-Agent
        $this->withHeaders([
            'X-Tab-Token' => $tabToken,
            'User-Agent' => 'AttackerBrowser/1.0',
        ])
            ->getJson('/api/user')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'SESSION_FINGERPRINT_MISMATCH');
    }

    public function test_idle_timeout_expires_inactive_session(): void
    {
        Config::set('session.idle_timeout', 60);

        $user = User::factory()->create(['password' => 'Secret123']);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'Secret123',
        ])->assertOk();

        $tabToken = (string) $loginResponse->json('tab_token');

        $this->travel(65)->seconds();

        $this->withHeaders(['X-Tab-Token' => $tabToken])
            ->getJson('/api/user')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'SESSION_IDLE_TIMEOUT');
    }

    public function test_api_responses_include_strict_security_and_no_store_headers(): void
    {
        $response = $this->getJson('/api/health');

        $response->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('X-Frame-Options', 'DENY')
            ->assertHeader('Referrer-Policy', 'no-referrer')
            ->assertHeader('Pragma', 'no-cache');

        $this->assertStringContainsString(
            'no-store',
            (string) $response->headers->get('Cache-Control'),
        );
    }
}
