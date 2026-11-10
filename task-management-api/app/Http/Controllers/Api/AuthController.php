<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Requests\Auth\SwitchRoleRequest;
use App\Http\Resources\UserResource;
use App\Services\AuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Session-based authentication and RBAC role management endpoints
 * for the Angular SPA (Laravel Sanctum).
 *
 * The client first calls GET /sanctum/csrf-cookie, then sends credentials
 * with the X-XSRF-TOKEN header; Laravel responds with an HttpOnly session cookie
 * and a per-tab cryptographic token (`tab_token`).
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
        $tabToken = $this->authService->currentTabToken($request);

        return response()->json([
            'message' => 'Registration successful',
            'user' => new UserResource($user),
            'tab_token' => $tabToken,
        ], 201)->withHeaders($tabToken ? ['X-Tab-Token' => $tabToken] : []);
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
            $request->validated('role'),
        );
        $tabToken = $this->authService->currentTabToken($request);

        return response()->json([
            'message' => 'Login successful',
            'user' => new UserResource($user),
            'tab_token' => $tabToken,
        ])->withHeaders($tabToken ? ['X-Tab-Token' => $tabToken] : []);
    }

    /**
     * POST /api/auth/switch-role
     */
    public function switchRole(SwitchRoleRequest $request): JsonResponse
    {
        $user = $this->authService->switchRole(
            $request->user(),
            $request->validated('role'),
            $request,
        );
        $tabToken = $this->authService->currentTabToken($request);

        return response()->json([
            'message' => 'Role switched successfully',
            'user' => new UserResource($user),
            'tab_token' => $tabToken,
        ])->withHeaders($tabToken ? ['X-Tab-Token' => $tabToken] : []);
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
