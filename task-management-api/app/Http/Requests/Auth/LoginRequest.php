<?php

declare(strict_types=1);

namespace App\Http\Requests\Auth;

use App\Enums\UserRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validates login credentials and selected session role (POST /api/login).
 */
class LoginRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $merged = [];

        if (is_string($this->email)) {
            $merged['email'] = strtolower(trim($this->email));
        }

        if (is_string($this->role)) {
            $merged['role'] = strtolower(trim($this->role));
        }

        if ($merged !== []) {
            $this->merge($merged);
        }
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string'],
            'remember' => ['sometimes', 'boolean'],
            'role' => ['sometimes', 'string', Rule::enum(UserRole::class)],
        ];
    }
}
