<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\TaskPriority;
use App\Enums\TaskStatus;
use Database\Factories\TaskFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Eloquent model for the `tasks` table.
 *
 * @property int $id
 * @property int $user_id
 * @property int|null $assigned_to_user_id
 * @property int|null $assigned_by_user_id
 * @property string $title
 * @property string|null $description
 * @property TaskStatus $status
 * @property TaskPriority $priority
 * @property Carbon|null $due_date
 * @property Carbon $created_at
 * @property Carbon $updated_at
 * @property-read User|null $user
 * @property-read User|null $assignee
 * @property-read User|null $assigner
 */
class Task extends Model
{
    /** @use HasFactory<TaskFactory> */
    use HasFactory;

    /**
     * Only these attributes may be mass-assigned.
     * Ownership (`user_id`) and assignment (`assigned_to_user_id`, `assigned_by_user_id`)
     * are assigned explicitly by the service/repository layer.
     *
     * @var list<string>
     */
    protected $fillable = [
        'title',
        'description',
        'status',
        'priority',
        'due_date',
    ];

    /**
     * In-memory defaults, mirroring the database column defaults.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'status' => 'Pending',
        'priority' => 'Medium',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'assigned_to_user_id' => 'integer',
            'assigned_by_user_id' => 'integer',
            'status' => TaskStatus::class,
            'priority' => TaskPriority::class,
            'due_date' => 'date:Y-m-d',
        ];
    }

    /**
     * The user who created/owns this task (`created_by`).
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The user to whom this task is assigned (`assigned_to`).
     *
     * @return BelongsTo<User, $this>
     */
    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_to_user_id');
    }

    /**
     * The user who assigned this task (`assigned_by`).
     *
     * @return BelongsTo<User, $this>
     */
    public function assigner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_by_user_id');
    }
}
