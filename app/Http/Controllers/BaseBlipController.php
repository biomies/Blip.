<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\BlipUser;
use Carbon\Carbon;
use Illuminate\Support\Str;

abstract class BaseBlipController extends Controller
{
    /**
     * Helper to get or create BlipUser based on session_token
     */
    protected function resolveUser(Request $request): BlipUser
    {
        $token = $request->header('X-Blip-Token') ?? $request->cookie('blip_token') ?? $request->input('session_token');

        $user = null;
        if ($token) {
            $user = BlipUser::where('session_token', $token)->first();
        }

        if (!$user) {
            $adjectives = ['Ramah', 'Ceria', 'Santai', 'Asik', 'Keren', 'Misterius', 'Hebat', 'Sigap', 'Tenang'];
            $nouns = ['Kucing', 'Kopi', 'Piknik', 'Bintang', 'Lentera', 'Awan', 'Senja', 'Ombak', 'Pohon'];
            $adj = $adjectives[array_rand($adjectives)];
            $noun = $nouns[array_rand($nouns)];
            $randomDisplayName = $adj . ' ' . $noun;

            // Generate unique twitter-like handle e.g. "santai_kucing82"
            $adjLower = strtolower($adj);
            $nounLower = strtolower($noun);
            do {
                $randomUsername = $adjLower . '_' . $nounLower . rand(10, 999);
            } while (BlipUser::where('username', $randomUsername)->exists());

            $colors = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e'];
            $color = $colors[array_rand($colors)];

            $user = BlipUser::create([
                'session_token' => (string) Str::uuid(),
                'name' => $randomDisplayName,
                'username' => $randomUsername,
                'is_onboarded' => false,
                'avatar_color' => $color,
                'last_active_at' => Carbon::now(),
            ]);
        } else {
            // Perbarui last_active_at setiap ada akses
            $user->update(['last_active_at' => Carbon::now()]);
        }

        return $user;
    }

    /**
     * Hitung jarak dua koordinat dengan rumus Haversine (dalam kilometer)
     */
    protected function calculateDistance($lat1, $lon1, $lat2, $lon2)
    {
        if (is_null($lat1) || is_null($lon1) || is_null($lat2) || is_null($lon2)) {
            return null;
        }

        $earthRadius = 6371; // km

        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);

        $a = sin($dLat / 2) * sin($dLat / 2) +
             cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
             sin($dLon / 2) * sin($dLon / 2);

        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
        $distance = $earthRadius * $c;

        return round($distance, 2);
    }

    /**
     * Format jarak numerik (km) menjadi string ringkas (misal: 150 m atau 2.4 km)
     */
    protected function formatDistanceText($dist): string
    {
        if ($dist === null) {
            return 'Jarak ?';
        }
        if ($dist < 0.05) {
            return '0 m';
        }
        return $dist < 1 ? round($dist * 1000) . ' m' : round($dist, 1) . ' km';
    }
}

