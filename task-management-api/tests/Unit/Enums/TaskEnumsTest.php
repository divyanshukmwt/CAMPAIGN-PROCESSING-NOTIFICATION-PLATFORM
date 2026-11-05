<?php

namespace Tests\Unit\Enums;

use App\Enums\TaskPriority;
use App\Enums\TaskStatus;
use PHPUnit\Framework\TestCase;

class TaskEnumsTest extends TestCase
{
    public function test_status_values_match_the_specification(): void
    {
        $this->assertSame(['Pending', 'In Progress', 'Completed'], TaskStatus::values());
        $this->assertSame(TaskStatus::Pending, TaskStatus::DEFAULT);
        $this->assertSame(TaskStatus::InProgress, TaskStatus::from('In Progress'));
    }

    public function test_priority_values_match_the_specification(): void
    {
        $this->assertSame(['Low', 'Medium', 'High'], TaskPriority::values());
        $this->assertSame(TaskPriority::Medium, TaskPriority::DEFAULT);
    }

    public function test_invalid_values_are_rejected(): void
    {
        $this->assertNull(TaskStatus::tryFrom('Done'));
        $this->assertNull(TaskPriority::tryFrom('Urgent'));
        $this->assertNull(TaskStatus::tryFrom('pending'));
    }
}
