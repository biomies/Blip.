<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\BlipController;

Route::get('/', [BlipController::class, 'index'])->name('home');

Route::prefix('api/blip')->group(function () {
    Route::get('/init', [BlipController::class, 'initUser']);
    Route::get('/check-username', [BlipController::class, 'checkUsernameAvailability']);
    Route::post('/profile', [BlipController::class, 'updateProfile']);
    Route::post('/profile/avatar', [BlipController::class, 'updateAvatar']);
    Route::delete('/profile/avatar', [BlipController::class, 'removeAvatar']);
    Route::delete('/account', [BlipController::class, 'deleteAccount']);
    Route::post('/location', [BlipController::class, 'updateLocation']);
    Route::get('/nearby', [BlipController::class, 'getNearbyUsers']);
    Route::post('/friend-request', [BlipController::class, 'sendFriendRequest']);
    Route::post('/friend-respond', [BlipController::class, 'respondFriendRequest']);
    Route::delete('/friend/{friendId}', [BlipController::class, 'removeFriend']);
    Route::get('/friends', [BlipController::class, 'getFriendsAndRequests']);
    Route::get('/messages/{friendId}', [BlipController::class, 'getMessages']);
    Route::post('/messages/{friendId}/read', [BlipController::class, 'markAsRead']);
    Route::post('/messages/{friendId}', [BlipController::class, 'sendMessage']);
    Route::post('/messages/{friendId}/photo', [BlipController::class, 'sendPhotoMessage']);
    Route::post('/messages/{messageId}/save-photo', [BlipController::class, 'savePhotoMessage']);
    Route::delete('/messages/{messageId}', [BlipController::class, 'deleteSingleMessage']);
    Route::post('/messages/bulk-delete', [BlipController::class, 'bulkDeleteMessages']);
    Route::delete('/messages/clear/{friendId}', [BlipController::class, 'clearChat']);
    Route::post('/seed-demo', [BlipController::class, 'seedNearbyDemoUsers']);
});
