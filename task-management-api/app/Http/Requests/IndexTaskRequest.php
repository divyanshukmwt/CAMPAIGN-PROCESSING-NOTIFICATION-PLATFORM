<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validates query parameters for listing tasks (GET /api/tasks?search=...&user_id=...).
 */
class IndexTaskRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'search' => ['nullable', 'string', 'max:255'],
            'user_id' => ['nullable', 'integer', 'exists:users,id'],
        ];
    }

    /**
     * Trimmed search term, or null when absent/blank.
     */
    public function searchTerm(): ?string
    {
        $term = trim((string) $this->validated('search', ''));

        return $term === '' ? null : $term;
    }

    /**
     * Optional user ID filter (respected when the user is acting as Admin).
     */
    public function filterUserId(): ?int
    {
        $userId = $this->validated('user_id');

        return $userId !== null ? (int) $userId : null;
    }
}
