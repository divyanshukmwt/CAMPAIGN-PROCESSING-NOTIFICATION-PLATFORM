<?php

declare(strict_types=1);

namespace App\Http\Requests\Auth;

use App\Enums\UserRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * Validates user registration (POST /api/register).
 */
class RegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $merged = [
            'name' => is_string($this->name) ? trim($this->name) : $this->name,
            'email' => is_string($this->email) ? strtolower(trim($this->email)) : $this->email,
        ];

        if (is_string($this->role)) {
            $merged['role'] = strtolower(trim($this->role));
        }

        $this->merge($merged);
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'confirmed', Password::min(8)->letters()->numbers()],
            'role' => ['sometimes', 'string', Rule::enum(UserRole::class)],
            'dual_role' => ['sometimes', 'boolean'],
        ];
    }
}
