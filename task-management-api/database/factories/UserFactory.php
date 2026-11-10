<?php

namespace Database\Factories;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    /**
     * The current password being used by the factory.
     */
    protected static ?string $password;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => static::$password ??= Hash::make('password'),
            'roles' => [UserRole::User->value],
            'remember_token' => Str::random(10),
        ];
    }

    /**
     * Indicate that the model's email address should be unverified.
     */
    public function unverified(): static
    {
        return $this->state(fn (array $attributes) => [
            'email_verified_at' => null,
        ]);
    }

    /**
     * Account with only the `admin` role.
     */
    public function admin(): static
    {
        return $this->state(fn (array $attributes) => [
            'roles' => [UserRole::Admin->value],
        ]);
    }

    /**
     * Dual-role account holding both `admin` and `user` roles.
     */
    public function dualRole(): static
    {
        return $this->state(fn (array $attributes) => [
            'roles' => [UserRole::Admin->value, UserRole::User->value],
        ]);
    }
}
