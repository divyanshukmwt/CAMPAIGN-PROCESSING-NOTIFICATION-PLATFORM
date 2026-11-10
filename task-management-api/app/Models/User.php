<?php

declare(strict_types=1);

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Enums\UserRole;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

/**
 * @property int $id
 * @property string $name
 * @property string $email
 * @property string $password
 * @property list<string>|null $roles
 */
#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * In-memory default roles for new accounts (`roles` is intentionally
     * excluded from `$fillable` to prevent privilege escalation).
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'roles' => '["user"]',
    ];

    /**
     * Active role resolved for the current HTTP request/session lifecycle.
     */
    private ?UserRole $currentActiveRole = null;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'roles' => 'array',
        ];
    }

    /**
     * Normalised list of role values assigned to this user.
     *
     * @return list<string>
     */
    public function roleValues(): array
    {
        $raw = $this->roles;
        if (! is_array($raw) || $raw === []) {
            return [UserRole::DEFAULT->value];
        }

        $allowed = UserRole::values();
        $filtered = array_values(array_unique(array_filter(
            $raw,
            static fn (mixed $role): bool => is_string($role) && in_array($role, $allowed, true),
        )));

        return $filtered !== [] ? $filtered : [UserRole::DEFAULT->value];
    }

    public function hasRole(UserRole|string $role): bool
    {
        $value = $role instanceof UserRole ? $role->value : $role;

        return in_array($value, $this->roleValues(), true);
    }

    public function hasDualRoles(): bool
    {
        return $this->hasRole(UserRole::Admin) && $this->hasRole(UserRole::User);
    }

    public function setActiveRole(UserRole|string $role): void
    {
        $resolved = $role instanceof UserRole ? $role : (UserRole::tryFrom($role) ?? UserRole::DEFAULT);

        if ($this->hasRole($resolved)) {
            $this->currentActiveRole = $resolved;
        }
    }

    public function activeRole(): UserRole
    {
        if ($this->currentActiveRole !== null && $this->hasRole($this->currentActiveRole)) {
            return $this->currentActiveRole;
        }

        if ($this->hasRole(UserRole::DEFAULT)) {
            return UserRole::DEFAULT;
        }

        $first = $this->roleValues()[0] ?? UserRole::DEFAULT->value;

        return UserRole::tryFrom($first) ?? UserRole::DEFAULT;
    }

    public function isActingAsAdmin(): bool
    {
        return $this->activeRole() === UserRole::Admin && $this->hasRole(UserRole::Admin);
    }

    /**
     * Tasks owned/created by this user.
     *
     * @return HasMany<Task, $this>
     */
    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }
}
