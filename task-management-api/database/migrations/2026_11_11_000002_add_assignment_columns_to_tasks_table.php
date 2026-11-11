<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Version 3 of the tasks schema: task assignment and attribution.
 *
 * Adds:
 * - `assigned_to_user_id` (FK -> users.id, null on delete)
 * - `assigned_by_user_id` (FK -> users.id, null on delete)
 * Existing rows default both columns to `user_id` (creator).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->foreignId('assigned_to_user_id')
                ->nullable()
                ->after('user_id')
                ->constrained('users')
                ->nullOnDelete();

            $table->foreignId('assigned_by_user_id')
                ->nullable()
                ->after('assigned_to_user_id')
                ->constrained('users')
                ->nullOnDelete();

            $table->index(['assigned_to_user_id', 'created_at']);
        });

        DB::table('tasks')
            ->whereNull('assigned_to_user_id')
            ->update([
                'assigned_to_user_id' => DB::raw('user_id'),
                'assigned_by_user_id' => DB::raw('user_id'),
            ]);
    }

    public function down(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->dropForeign(['assigned_to_user_id']);
            $table->dropForeign(['assigned_by_user_id']);
            $table->dropIndex(['assigned_to_user_id', 'created_at']);
            $table->dropColumn(['assigned_to_user_id', 'assigned_by_user_id']);
        });
    }
};
