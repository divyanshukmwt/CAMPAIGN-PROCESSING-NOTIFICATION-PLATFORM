<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Admin-only directory of users for task assignment and user task filtering.
 */
class UserController extends Controller
{
    /**
     * GET /api/users
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $user = $request->user();

        if (! $user instanceof User || ! $user->isActingAsAdmin()) {
            throw new AccessDeniedHttpException('Admin role is required to view users.');
        }

        $users = User::query()
            ->orderBy('name')
            ->orderBy('id')
            ->get();

        return UserResource::collection($users);
    }
}
