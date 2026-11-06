<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Demo account for local development only (never use in production).
     */
    public const DEMO_EMAIL = 'test@example.com';

    public const DEMO_PASSWORD = 'Password123';

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        if (! User::where('email', self::DEMO_EMAIL)->exists()) {
            User::factory()->create([
                'name' => 'Test User',
                'email' => self::DEMO_EMAIL,
                'password' => self::DEMO_PASSWORD,
            ]);
        }

        $this->call(TaskSeeder::class);
    }
}
