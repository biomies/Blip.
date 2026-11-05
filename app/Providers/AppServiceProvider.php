<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\URL;

class AppServiceProvider extends ServiceProvider
{
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
        if (config('app.env') === 'production' || str_starts_with(config('app.url'), 'https://')) {
            URL::forceScheme('https');
        }
        // Rate limiter posting knot (max 15 postingan per menit per user/IP)
        RateLimiter::for('knot-posts', function (Request $request) {
            $key = $request->header('X-Blip-Token') ?: $request->header('X-Session-Token') ?: $request->ip();
            return Limit::perMinute(15)->by($key)->response(function () {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Anda memposting terlalu cepat. Tunggu sebentar sebelum memposting knot lagi.',
                ], 429);
            });
        });

        // Rate limiter like knot (max 60 like per menit per user/IP)
        RateLimiter::for('knot-likes', function (Request $request) {
            $key = $request->header('X-Blip-Token') ?: $request->header('X-Session-Token') ?: $request->ip();
            return Limit::perMinute(60)->by($key)->response(function () {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Terlalu banyak aktivitas suka. Silakan tunggu beberapa saat.',
                ], 429);
            });
        });
    }
}
