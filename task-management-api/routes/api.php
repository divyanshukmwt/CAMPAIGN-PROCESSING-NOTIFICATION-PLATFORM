<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\TaskController;
use App\Http\Controllers\Api\UserController;
use App\Http\Middleware\EnsureSingleTabSession;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class)->name('api.health');

// Authentication (Sanctum SPA, session cookie) — stricter rate limits
Route::post('/register', [AuthController::class, 'register'])
    ->middleware('throttle:register')->name('auth.register');
Route::post('/login', [AuthController::class, 'login'])
    ->middleware('throttle:login')->name('auth.login');

Route::middleware(['auth:sanctum', EnsureSingleTabSession::class])->group(function () {
    Route::post('/logout', [AuthController::class, 'logout'])->name('auth.logout');
    Route::get('/user', [AuthController::class, 'user'])->name('auth.user');
    Route::post('/auth/switch-role', [AuthController::class, 'switchRole'])->name('auth.switch-role');
    Route::get('/users', [UserController::class, 'index'])->name('users.index');

    // Task CRUD — scoped to the authenticated user/role via TaskPolicy
    Route::apiResource('tasks', TaskController::class);
});
