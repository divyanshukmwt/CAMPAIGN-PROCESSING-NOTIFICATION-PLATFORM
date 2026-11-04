<?php

namespace Tests\Feature;

use Tests\TestCase;

class CorsTest extends TestCase
{
    public function test_preflight_from_trusted_angular_origin_is_allowed_with_credentials(): void
    {
        $this->call('OPTIONS', '/api/user', [], [], [], [
            'HTTP_ORIGIN' => 'http://localhost:4200',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
            'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'content-type',
        ])
            ->assertNoContent()
            ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:4200')
            ->assertHeader('Access-Control-Allow-Credentials', 'true');
    }

    public function test_untrusted_origin_is_not_allowed(): void
    {
        $response = $this->call('OPTIONS', '/api/user', [], [], [], [
            'HTTP_ORIGIN' => 'http://evil.example.com',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
        ]);

        $allowed = $response->headers->get('Access-Control-Allow-Origin');
        $this->assertNotSame('http://evil.example.com', $allowed);
        $this->assertNotSame('*', $allowed);
    }

    public function test_sanctum_csrf_cookie_endpoint_is_available(): void
    {
        $this->get('/sanctum/csrf-cookie')
            ->assertNoContent()
            ->assertCookie('XSRF-TOKEN');
    }

    public function test_sanctum_protected_route_rejects_unauthenticated_requests(): void
    {
        $this->getJson('/api/user')->assertUnauthorized();
    }
}
