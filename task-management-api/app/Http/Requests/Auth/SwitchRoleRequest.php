<?php

declare(strict_types=1);

namespace App\Http\Requests\Auth;

use App\Enums\UserRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validates role switching within an active session (POST /api/auth/switch-role).
 */
class SwitchRoleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->role)) {
            $this->merge(['role' => strtolower(trim($this->role))]);
        }
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'role' => ['required', 'string', Rule::enum(UserRole::class)],
        ];
    }
}
