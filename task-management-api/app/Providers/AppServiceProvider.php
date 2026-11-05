<?php

namespace App\Providers;

use App\Contracts\TaskRepositoryInterface;
use App\Repositories\TaskRepository;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Interface-to-implementation bindings resolved by the service container.
     *
     * @var array<class-string, class-string>
     */
    public array $bindings = [
        TaskRepositoryInterface::class => TaskRepository::class,
    ];

    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // API responses follow the documented contract: collections are plain
        // JSON arrays and single resources are plain objects (no "data" wrapper).
        JsonResource::withoutWrapping();
    }
}
