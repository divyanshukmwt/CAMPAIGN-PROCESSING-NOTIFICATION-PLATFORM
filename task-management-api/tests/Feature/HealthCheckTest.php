<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class HealthCheckTest extends TestCase
{
    use RefreshDatabase;

    public function test_health_endpoint_reports_ok_and_connected_database(): void
    {
        $this->getJson('/api/health')
            ->assertOk()
            ->assertJson([
                'status' => 'ok',
                'database' => 'connected',
            ])
            ->assertJsonStructure(['status', 'service', 'database', 'timestamp']);
    }

    public function test_application_is_connected_to_mysql(): void
    {
        $this->assertSame('mysql', DB::connection()->getDriverName());
        $this->assertSame('task_management_test', DB::connection()->getDatabaseName());
    }

    public function test_unknown_api_route_returns_json_404(): void
    {
        $this->getJson('/api/does-not-exist')
            ->assertNotFound()
            ->assertHeader('Content-Type', 'application/json');
    }
}
