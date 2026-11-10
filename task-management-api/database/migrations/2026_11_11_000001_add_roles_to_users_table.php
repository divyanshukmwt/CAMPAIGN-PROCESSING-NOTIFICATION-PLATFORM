<?php

use App\Enums\UserRole;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the `roles` JSON column to `users` to support RBAC (`admin`, `user`)
 * and dual-role accounts (`["admin", "user"]`) capable of switching roles.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->json('roles')->nullable()->after('password');
        });

        DB::table('users')
            ->whereNull('roles')
            ->update(['roles' => json_encode([UserRole::User->value])]);
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('roles');
        });
    }
};
