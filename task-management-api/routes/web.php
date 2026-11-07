<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    $spaIndex = public_path('index.html');

    return is_file($spaIndex) ? response()->file($spaIndex) : view('welcome');
});

Route::get('/{any}', function () {
    $spaIndex = public_path('index.html');

    if (is_file($spaIndex)) {
        return response()->file($spaIndex);
    }

    abort(404);
})->where('any', '^(?!api(?:/|$)|sanctum(?:/|$)|up$).*$');
