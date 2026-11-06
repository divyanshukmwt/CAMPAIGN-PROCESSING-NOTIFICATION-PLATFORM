<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\IndexTaskRequest;
use App\Http\Requests\StoreTaskRequest;
use App\Http\Requests\UpdateTaskRequest;
use App\Http\Resources\TaskResource;
use App\Models\Task;
use App\Services\TaskService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * REST endpoints for tasks (authenticated; users only see their own tasks).
 *
 * Thin controller: validation is handled by Form Requests, authorisation by
 * TaskPolicy and business logic by TaskService (injected via the constructor).
 */
class TaskController extends Controller
{
    public function __construct(
        private readonly TaskService $taskService,
    ) {}

    /**
     * GET /api/tasks — the user's tasks, newest first. Optional ?search= filters by title.
     */
    public function index(IndexTaskRequest $request): AnonymousResourceCollection
    {
        return TaskResource::collection(
            $this->taskService->getAllTasks($request->user(), $request->searchTerm())
        );
    }

    /**
     * POST /api/tasks — create a task owned by the authenticated user.
     */
    public function store(StoreTaskRequest $request): JsonResponse
    {
        $task = $this->taskService->createTask($request->user(), $request->validated());

        return response()->json([
            'message' => 'Task created successfully',
            'data' => new TaskResource($task),
        ], 201);
    }

    /**
     * GET /api/tasks/{task} — a single task.
     */
    public function show(Task $task): TaskResource
    {
        Gate::authorize('view', $task);

        return new TaskResource($task);
    }

    /**
     * PUT/PATCH /api/tasks/{task} — update a task (partial updates allowed).
     * Authorisation happens in UpdateTaskRequest::authorize() before validation.
     */
    public function update(UpdateTaskRequest $request, Task $task): JsonResponse
    {
        $task = $this->taskService->updateTask($task, $request->validated());

        return response()->json([
            'message' => 'Task updated successfully',
            'data' => new TaskResource($task),
        ]);
    }

    /**
     * DELETE /api/tasks/{task} — delete a task.
     */
    public function destroy(Task $task): JsonResponse
    {
        Gate::authorize('delete', $task);

        $this->taskService->deleteTask($task);

        return response()->json([
            'message' => 'Task deleted successfully',
        ]);
    }
}
