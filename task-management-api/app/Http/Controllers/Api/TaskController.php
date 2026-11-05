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

/**
 * REST endpoints for tasks.
 *
 * Thin controller: validation is handled by Form Requests and business
 * logic by TaskService (injected via the constructor).
 */
class TaskController extends Controller
{
    public function __construct(
        private readonly TaskService $taskService,
    ) {}

    /**
     * GET /api/tasks — all tasks, newest first. Optional ?search= filters by title.
     */
    public function index(IndexTaskRequest $request): AnonymousResourceCollection
    {
        return TaskResource::collection($this->taskService->getAllTasks($request->searchTerm()));
    }

    /**
     * POST /api/tasks — create a task.
     */
    public function store(StoreTaskRequest $request): JsonResponse
    {
        $task = $this->taskService->createTask($request->validated());

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
        return new TaskResource($task);
    }

    /**
     * PUT/PATCH /api/tasks/{task} — update a task (partial updates allowed).
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
        $this->taskService->deleteTask($task);

        return response()->json([
            'message' => 'Task deleted successfully',
        ]);
    }
}
