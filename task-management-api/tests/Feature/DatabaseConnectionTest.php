<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class DatabaseConnectionTest extends TestCase
{
    use RefreshDatabase;

    public function test_application_uses_the_mysql_test_database(): void
    {
        $this->assertSame('mysql', DB::connection()->getDriverName());
        $this->assertSame('task_management_test', DB::connection()->getDatabaseName());
    }

    public function test_mysql_accepts_queries_and_migrations_have_run(): void
    {
        $this->assertSame(1, (int) DB::selectOne('select 1 as ok')->ok);
        $this->assertTrue(Schema::hasTable('migrations'));
        $this->assertTrue(Schema::hasTable('users'));
    }
}
