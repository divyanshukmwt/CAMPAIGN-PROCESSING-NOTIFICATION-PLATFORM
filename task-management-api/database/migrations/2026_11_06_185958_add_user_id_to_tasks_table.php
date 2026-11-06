<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Version 2 of the tasks schema: per-user ownership.
 *
 * Adds tasks.user_id (FK -> users.id, cascade on delete) and a composite
 * index for the main query "my tasks, newest first". Existing rows are
 * assigned to the earliest user; if no user exists they cannot be owned
 * and are removed before the column becomes NOT NULL.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->foreignId('user_id')->nullable()->after('id')
                ->constrained()->cascadeOnDelete();
        });

        $ownerId = DB::table('users')->orderBy('id')->value('id');
        if ($ownerId !== null) {
            DB::table('tasks')->whereNull('user_id')->update(['user_id' => $ownerId]);
        } else {
            DB::table('tasks')->whereNull('user_id')->delete();
        }

        Schema::table('tasks', function (Blueprint $table) {
            $table->foreignId('user_id')->nullable(false)->change();
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->dropForeign(['user_id']);
            $table->dropIndex(['user_id', 'created_at']);
            $table->dropColumn('user_id');
        });
    }
};
