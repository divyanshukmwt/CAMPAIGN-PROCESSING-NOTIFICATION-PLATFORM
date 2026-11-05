<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Creates the `tasks` table exactly as specified in the requirements:
 * id BIGINT PK, title VARCHAR(255), description TEXT, status VARCHAR(30),
 * priority VARCHAR(20), due_date DATE, created_at / updated_at TIMESTAMP.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tasks', function (Blueprint $table) {
            $table->id();
            $table->string('title', 255);
            $table->text('description')->nullable();
            $table->string('status', 30)->default('Pending');
            $table->string('priority', 20)->default('Medium');
            $table->date('due_date')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tasks');
    }
};
