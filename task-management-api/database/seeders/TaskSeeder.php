<?php

namespace Database\Seeders;

use App\Enums\TaskPriority;
use App\Enums\TaskStatus;
use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Seeder;

/**
 * Seeds sample tasks for local development and demos, owned by the demo user.
 */
class TaskSeeder extends Seeder
{
    public function run(): void
    {
        $owner = User::where('email', DatabaseSeeder::DEMO_EMAIL)->first()
            ?? User::factory()->create([
                'name' => 'Test User',
                'email' => DatabaseSeeder::DEMO_EMAIL,
                'password' => DatabaseSeeder::DEMO_PASSWORD,
            ]);

        $samples = [
            [
                'title' => 'Learn Laravel',
                'description' => 'Understand Laravel API development',
                'status' => TaskStatus::Pending,
                'priority' => TaskPriority::High,
                'due_date' => '2026-12-31',
            ],
            [
                'title' => 'Build Angular task list',
                'description' => 'Display tasks returned by the Laravel REST API',
                'status' => TaskStatus::InProgress,
                'priority' => TaskPriority::Medium,
                'due_date' => now()->addWeeks(2)->toDateString(),
            ],
            [
                'title' => 'Configure MySQL database',
                'description' => 'Create the task_management database and run migrations',
                'status' => TaskStatus::Completed,
                'priority' => TaskPriority::Low,
                'due_date' => null,
            ],
        ];

        foreach ($samples as $sample) {
            $owner->tasks()->firstOrCreate(['title' => $sample['title']], $sample);
        }

        Task::factory()->count(7)->for($owner)->create();
    }
}
