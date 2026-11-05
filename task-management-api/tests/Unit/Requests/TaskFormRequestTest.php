<?php

namespace Tests\Unit\Requests;

use App\Http\Requests\StoreTaskRequest;
use App\Http\Requests\UpdateTaskRequest;
use Illuminate\Support\Facades\Validator;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class TaskFormRequestTest extends TestCase
{
    /**
     * @param  array<string, mixed>  $data
     * @return array<string, list<string>>
     */
    private function storeErrors(array $data): array
    {
        $request = new StoreTaskRequest;

        return Validator::make($data, $request->rules(), $request->messages())->errors()->toArray();
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, list<string>>
     */
    private function updateErrors(array $data): array
    {
        $request = new UpdateTaskRequest;

        return Validator::make($data, $request->rules(), $request->messages())->errors()->toArray();
    }

    private function validPayload(): array
    {
        return [
            'title' => 'Learn Laravel',
            'description' => 'Understand Laravel API development',
            'status' => 'Pending',
            'priority' => 'High',
            'due_date' => '2026-12-31',
        ];
    }

    public function test_reference_payload_is_valid_for_store(): void
    {
        $this->assertSame([], $this->storeErrors($this->validPayload()));
    }

    public function test_optional_fields_may_be_null_or_missing_on_store(): void
    {
        $this->assertSame([], $this->storeErrors([
            'title' => 'Minimal', 'status' => 'Completed', 'priority' => 'Low',
            'description' => null, 'due_date' => null,
        ]));
        $this->assertSame([], $this->storeErrors(['title' => 'Minimal', 'status' => 'In Progress', 'priority' => 'Medium']));
    }

    /**
     * @return array<string, array{0: array<string, mixed>, 1: string}>
     */
    public static function invalidStorePayloads(): array
    {
        return [
            'missing title' => [['title' => null], 'title'],
            'empty title' => [['title' => ''], 'title'],
            'title too long' => [['title' => str_repeat('a', 256)], 'title'],
            'title not string' => [['title' => ['x']], 'title'],
            'description not string' => [['description' => 123], 'description'],
            'missing status' => [['status' => null], 'status'],
            'invalid status' => [['status' => 'Done'], 'status'],
            'lowercase status' => [['status' => 'pending'], 'status'],
            'missing priority' => [['priority' => null], 'priority'],
            'invalid priority' => [['priority' => 'Urgent'], 'priority'],
            'invalid date' => [['due_date' => 'not-a-date'], 'due_date'],
        ];
    }

    #[DataProvider('invalidStorePayloads')]
    public function test_invalid_store_payloads_fail_on_the_expected_field(array $override, string $field): void
    {
        $errors = $this->storeErrors(array_merge($this->validPayload(), $override));

        $this->assertArrayHasKey($field, $errors);
        $this->assertCount(1, $errors, 'Only the invalid field should fail');
    }

    public function test_title_of_exactly_255_characters_is_valid(): void
    {
        $this->assertSame([], $this->storeErrors(array_merge($this->validPayload(), ['title' => str_repeat('a', 255)])));
    }

    public function test_enum_error_messages_list_allowed_values(): void
    {
        $errors = $this->storeErrors(array_merge($this->validPayload(), ['status' => 'Done', 'priority' => 'Urgent']));

        $this->assertSame('The status must be one of: Pending, In Progress, Completed.', $errors['status'][0]);
        $this->assertSame('The priority must be one of: Low, Medium, High.', $errors['priority'][0]);
    }

    public function test_update_allows_partial_and_empty_payloads(): void
    {
        $this->assertSame([], $this->updateErrors([]));
        $this->assertSame([], $this->updateErrors(['status' => 'In Progress']));
        $this->assertSame([], $this->updateErrors([
            'title' => 'Learn Laravel and Angular', 'status' => 'In Progress', 'priority' => 'High',
        ]));
        $this->assertSame([], $this->updateErrors(['due_date' => null, 'description' => null]));
    }

    public function test_update_rejects_present_but_invalid_fields(): void
    {
        $errors = $this->updateErrors(['title' => '', 'status' => 'Done', 'priority' => null, 'due_date' => 'x']);

        $this->assertEqualsCanonicalizing(['title', 'status', 'priority', 'due_date'], array_keys($errors));
    }
}
