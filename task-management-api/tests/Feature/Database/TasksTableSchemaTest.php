<?php

namespace Tests\Feature\Database;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TasksTableSchemaTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return array<string, object>
     */
    private function columns(): array
    {
        $rows = DB::select(
            'SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
            ['tasks']
        );

        return collect($rows)->keyBy('COLUMN_NAME')->all();
    }

    public function test_tasks_table_exists_with_exactly_the_specified_columns(): void
    {
        $this->assertTrue(Schema::hasTable('tasks'));
        $this->assertEqualsCanonicalizing(
            ['id', 'title', 'description', 'status', 'priority', 'due_date', 'created_at', 'updated_at'],
            Schema::getColumnListing('tasks')
        );
    }

    public function test_column_types_match_the_specification(): void
    {
        $c = $this->columns();

        $this->assertSame('bigint', $c['id']->DATA_TYPE);
        $this->assertSame('PRI', $c['id']->COLUMN_KEY);

        $this->assertSame('varchar', $c['title']->DATA_TYPE);
        $this->assertSame(255, (int) $c['title']->CHARACTER_MAXIMUM_LENGTH);
        $this->assertSame('NO', $c['title']->IS_NULLABLE);

        $this->assertSame('text', $c['description']->DATA_TYPE);
        $this->assertSame('YES', $c['description']->IS_NULLABLE);

        $this->assertSame('varchar', $c['status']->DATA_TYPE);
        $this->assertSame(30, (int) $c['status']->CHARACTER_MAXIMUM_LENGTH);

        $this->assertSame('varchar', $c['priority']->DATA_TYPE);
        $this->assertSame(20, (int) $c['priority']->CHARACTER_MAXIMUM_LENGTH);

        $this->assertSame('date', $c['due_date']->DATA_TYPE);
        $this->assertSame('YES', $c['due_date']->IS_NULLABLE);

        $this->assertSame('timestamp', $c['created_at']->DATA_TYPE);
        $this->assertSame('timestamp', $c['updated_at']->DATA_TYPE);
    }

    public function test_status_and_priority_defaults_are_applied_by_the_database(): void
    {
        $id = DB::table('tasks')->insertGetId(['title' => 'Defaults check']);
        $row = DB::table('tasks')->find($id);

        $this->assertSame('Pending', $row->status);
        $this->assertSame('Medium', $row->priority);
        $this->assertNull($row->description);
        $this->assertNull($row->due_date);
    }
}
