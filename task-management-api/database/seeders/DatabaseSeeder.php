<?php

namespace Database\Seeders;

use App\Enums\UserRole;
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
        $demoUser = User::firstOrCreate(
            ['email' => self::DEMO_EMAIL],
            [
                'name' => 'Test User',
                'password' => self::DEMO_PASSWORD,
            ]
        );
        $demoUser->forceFill([
            'roles' => [UserRole::Admin->value, UserRole::User->value],
        ])->save();

        $this->call(TaskSeeder::class);
    }
}
