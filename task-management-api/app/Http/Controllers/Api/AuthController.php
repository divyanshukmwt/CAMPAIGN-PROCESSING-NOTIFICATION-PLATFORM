<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Resources\UserResource;
use App\Services\AuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Session-based authentication endpoints for the Angular SPA (Laravel Sanctum).
 *
 * The client first calls GET /sanctum/csrf-cookie, then sends credentials
 * with the X-XSRF-TOKEN header; Laravel responds with an HttpOnly session cookie.
 */
class AuthController extends Controller
{
    public function __construct(
        private readonly AuthService $authService,
    ) {}

    /**
     * POST /api/register
     */
    public function register(RegisterRequest $request): JsonResponse
    {
        $user = $this->authService->register($request->validated(), $request);

        return response()->json([
            'message' => 'Registration successful',
            'user' => new UserResource($user),
        ], 201);
    }

    /**
     * POST /api/login
     */
    public function login(LoginRequest $request): JsonResponse
    {
        $user = $this->authService->login(
            $request->validated('email'),
            $request->validated('password'),
            $request->boolean('remember'),
            $request,
        );

        return response()->json([
            'message' => 'Login successful',
            'user' => new UserResource($user),
        ]);
    }

    /**
     * POST /api/logout
     */
    public function logout(Request $request): JsonResponse
    {
        $this->authService->logout($request);

        return response()->json([
            'message' => 'Logged out successfully',
        ]);
    }

    /**
     * GET /api/user — the currently authenticated user.
     *
     * Status is set explicitly: JsonResource would otherwise return 201 for a
     * model created during the same request lifecycle.
     */
    public function user(Request $request): JsonResponse
    {
        return (new UserResource($request->user()))->response()->setStatusCode(200);
    }
}
