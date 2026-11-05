<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\BlipUser;
use App\Models\BlipFriendship;
use App\Models\BlipMessage;
use Illuminate\Support\Str;
use Carbon\Carbon;
use App\Events\MessageSent;
use App\Events\FriendNotification;
use App\Events\MessagesRead;
use App\Events\WebRtcSignal;

class BlipController extends Controller
{
    /**
     * Helper to get or create BlipUser based on session_token
     */
    private function resolveUser(Request $request): BlipUser
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
    private function calculateDistance($lat1, $lon1, $lat2, $lon2)
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
     * Halaman Utama
     */
    public function index(Request $request)
    {
        return view('blip');
    }

    /**
     * Inisialisasi User (cek cache/session / buat akun otomatis)
     */
    public function initUser(Request $request)
    {
        $user = $this->resolveUser($request);

        return response()->json([
            'status' => 'success',
            'user' => $user,
        ])->cookie('blip_token', $user->session_token, 60 * 24 * 30); // 30 hari cookie
    }

    /**
     * Update profil (nama, avatar color, gender, birthdate / age)
     */
    public function updateProfile(Request $request)
    {
        $user = $this->resolveUser($request);

        // Normalisasi username jika ada (hilangkan awalan @ dan lowercase)
        if ($request->has('username') && $request->username !== null) {
            $rawUsername = strtolower(ltrim(trim($request->username), '@'));
            $request->merge(['username' => $rawUsername]);
        }

        $request->validate([
            'name' => 'required|string|max:50',
            'username' => [
                'required',
                'string',
                'min:3',
                'max:25',
                'regex:/^[a-zA-Z0-9_]+$/',
                \Illuminate\Validation\Rule::unique('blip_users', 'username')->ignore($user->id),
            ],
            'avatar_color' => 'nullable|string|max:20',
            'gender' => 'nullable|in:male,female',
            'birthdate' => 'nullable|date|before:today|after:1900-01-01',
            'age' => 'nullable|integer|min:12|max:100',
            'bio' => 'nullable|string|max:160',
        ], [
            'username.required' => 'Username wajib diisi.',
            'username.min' => 'Username minimal 3 karakter.',
            'username.max' => 'Username maksimal 25 karakter.',
            'username.regex' => 'Username hanya boleh berupa huruf, angka, dan garis bawah (_).',
            'username.unique' => 'Username @' . $request->username . ' sudah digunakan oleh pengguna lain.',
        ]);

        $birthdate = $request->birthdate ? Carbon::parse($request->birthdate) : null;
        $age = $birthdate ? $birthdate->age : ($request->has('age') ? ($request->age ? (int)$request->age : null) : null);

        $cleanBio = null;
        if ($request->has('bio') && $request->bio !== null) {
            $cleanBio = trim(preg_replace('/[\r\n]+/', ' ', $request->bio));
        }

        $updateData = [
            'name' => $request->name,
            'username' => $request->username,
            'avatar_color' => $request->avatar_color ?? $user->avatar_color,
            'gender' => $request->has('gender') ? $request->gender : $user->gender,
            'birthdate' => $request->has('birthdate') ? ($request->birthdate ?: null) : $user->birthdate,
            'age' => $age,
            'bio' => $request->has('bio') ? $cleanBio : $user->bio,
        ];
        if (!empty($request->gender)) {
            $updateData['is_onboarded'] = true;
        }

        $user->update($updateData);

        return response()->json([
            'status' => 'success',
            'user' => $user,
        ]);
    }

    /**
     * Cek ketersediaan username secara real-time
     */
    public function checkUsernameAvailability(Request $request)
    {
        $user = $this->resolveUser($request);
        $raw = strtolower(ltrim(trim($request->query('username', '')), '@'));

        if (empty($raw)) {
            return response()->json([
                'status' => 'error',
                'available' => false,
                'message' => 'Username tidak boleh kosong.',
            ]);
        }

        if (strlen($raw) < 3) {
            return response()->json([
                'status' => 'error',
                'available' => false,
                'message' => 'Username minimal 3 karakter.',
            ]);
        }

        if (strlen($raw) > 25) {
            return response()->json([
                'status' => 'error',
                'available' => false,
                'message' => 'Username maksimal 25 karakter.',
            ]);
        }

        if (!preg_match('/^[a-zA-Z0-9_]+$/', $raw)) {
            return response()->json([
                'status' => 'error',
                'available' => false,
                'message' => 'Hanya boleh berisi huruf, angka, dan garis bawah (_).',
            ]);
        }

        $exists = BlipUser::where('username', $raw)
            ->where('id', '!=', $user->id)
            ->exists();

        if ($exists) {
            return response()->json([
                'status' => 'success',
                'available' => false,
                'message' => 'Username @' . $raw . ' sudah digunakan orang lain.',
            ]);
        }

        return response()->json([
            'status' => 'success',
            'available' => true,
            'message' => 'Username @' . $raw . ' tersedia!',
        ]);
    }

    /**
     * Upload & Perbarui Foto Profil Pengguna (Kompresi ~100 KB)
     */
    public function updateAvatar(Request $request)
    {
        $user = $this->resolveUser($request);

        $validator = \Illuminate\Support\Facades\Validator::make($request->all(), [
            'avatar' => 'required|file|image|max:15360', // Maks 15MB input mentah
        ]);

        if ($validator->fails()) {
            return response()->json([
                'status' => 'error',
                'message' => $validator->errors()->first(),
            ], 422);
        }

        $file = $request->file('avatar');
        if (!$file || !$file->isValid()) {
            return response()->json([
                'status' => 'error',
                'message' => 'File foto tidak valid.',
            ], 422);
        }

        $dir = storage_path('app/public/avatars');
        if (!file_exists($dir)) {
            mkdir($dir, 0755, true);
        }

        // Hapus foto lama jika ada
        if ($user->avatar_url) {
            $oldFilename = basename($user->avatar_url);
            $oldPath = $dir . '/' . $oldFilename;
            if (file_exists($oldPath)) {
                @unlink($oldPath);
            }
        }

        $fileName = 'avatar_' . $user->id . '_' . uniqid() . '.jpg';
        $targetPath = $dir . '/' . $fileName;

        // Kompres foto ke target ~100 KB
        $this->compressImageToTargetSize($file->getPathname(), $targetPath, 100 * 1024);

        $avatarUrl = '/storage/avatars/' . $fileName;
        $user->update([
            'avatar_url' => $avatarUrl,
        ]);

        return response()->json([
            'status' => 'success',
            'message' => 'Foto profil berhasil diperbarui.',
            'avatar_url' => $avatarUrl,
            'user' => $user,
        ]);
    }

    /**
     * Hapus Foto Profil Pengguna
     */
    public function removeAvatar(Request $request)
    {
        $user = $this->resolveUser($request);

        if ($user->avatar_url) {
            $filename = basename($user->avatar_url);
            $filePath = storage_path('app/public/avatars/' . $filename);
            if (file_exists($filePath)) {
                @unlink($filePath);
            }
            $user->update([
                'avatar_url' => null,
            ]);
        }

        return response()->json([
            'status' => 'success',
            'message' => 'Foto profil berhasil dihapus.',
            'user' => $user,
        ]);
    }

    /**
     * Hapus Akun Pengguna Secara Permanen Beserta Relasi & File Fisik
     */
    public function deleteAccount(Request $request)
    {
        $user = $this->resolveUser($request);
        $userId = $user->id;

        // 1. Hapus berkas foto profil pengguna
        if ($user->avatar_url) {
            $filename = basename($user->avatar_url);
            $avatarPath = storage_path('app/public/avatars/' . $filename);
            if (file_exists($avatarPath)) {
                @unlink($avatarPath);
            }
        }

        // 2. Hapus berkas foto pesan yang dikirimkan oleh pengguna ini
        $messagesWithPhotos = BlipMessage::where('sender_id', $userId)
            ->whereNotNull('photo_path')
            ->get();
        foreach ($messagesWithPhotos as $msg) {
            $photoPath = storage_path('app/public/' . $msg->photo_path);
            if (file_exists($photoPath)) {
                @unlink($photoPath);
            }
        }

        // 3. Notifikasi WebSocket ke semua teman bahwa pertemanan/akun terputus
        $friends = BlipFriendship::where('status', 'accepted')
            ->where(function ($q) use ($userId) {
                $q->where('user_id', $userId)->orWhere('friend_id', $userId);
            })->get();

        foreach ($friends as $f) {
            $targetFriendId = ($f->user_id == $userId) ? $f->friend_id : $f->user_id;
            try {
                broadcast(new FriendNotification($targetFriendId, 'friend_removed', $user));
            } catch (\Throwable $e) {}
        }

        // 4. Hapus user (blip_friendships dan blip_messages otomatis terhapus via ON DELETE CASCADE)
        $user->delete();

        // 5. Kembalikan response sukses dan bersihkan cookie sesi
        return response()->json([
            'status' => 'success',
            'message' => 'Akun dan seluruh data Anda telah berhasil dihapus.',
        ])->withoutCookie('blip_token');
    }

    /**
     * Update Lokasi Pengguna
     */
    public function updateLocation(Request $request)
    {
        $user = $this->resolveUser($request);

        $request->validate([
            'latitude' => 'required|numeric',
            'longitude' => 'required|numeric',
            'location_name' => 'nullable|string|max:100',
        ]);

        $user->update([
            'latitude' => $request->latitude,
            'longitude' => $request->longitude,
            'location_name' => $request->location_name ?? $user->location_name,
            'last_active_at' => Carbon::now(),
        ]);

        return response()->json([
            'status' => 'success',
            'user' => $user,
        ]);
    }

    /**
     * Mendapatkan orang-orang di sekitar (nearby users) dengan Spatial Bounding Box & Pagination
     */
    public function getNearbyUsers(Request $request)
    {
        $currentUser = $this->resolveUser($request);

        $radiusKm = (float) $request->query('radius', 15); // default radius 15 km
        $genderFilter = $request->query('gender', 'all'); // 'all', 'female', 'male'
        $page = max(1, (int) $request->query('page', 1));
        $limit = min(50, max(5, (int) $request->query('limit', 15))); // default 15 per page

        // Cari user yang aktif dalam 24 jam terakhir dan bukan diri sendiri
        $activeCutoff = Carbon::now()->subHours(24);
        $query = BlipUser::where('id', '!=', $currentUser->id)
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->where('last_active_at', '>=', $activeCutoff);

        // Filter Gender langsung di level Database Query
        if (in_array($genderFilter, ['male', 'female'])) {
            $query->where('gender', $genderFilter);
        }

        // Bounding Box (Kalkulasi cepat pra-filter di index MySQL)
        if ($currentUser->latitude && $currentUser->longitude) {
            // 1 derajat latitude ~ 111 km
            $latDelta = ($radiusKm / 111.0);
            // 1 derajat longitude ~ 111 km * cos(lat)
            $cosLat = cos(deg2rad($currentUser->latitude));
            $lonDelta = ($cosLat > 0.0001) ? ($radiusKm / (111.0 * $cosLat)) : ($radiusKm / 111.0);

            $minLat = $currentUser->latitude - $latDelta;
            $maxLat = $currentUser->latitude + $latDelta;
            $minLon = $currentUser->longitude - $lonDelta;
            $maxLon = $currentUser->longitude + $lonDelta;

            $query->whereBetween('latitude', [$minLat, $maxLat])
                  ->whereBetween('longitude', [$minLon, $maxLon]);
        }

        $otherUsers = $query->get();

        $nearby = [];

        foreach ($otherUsers as $other) {
            $dist = $this->calculateDistance(
                $currentUser->latitude,
                $currentUser->longitude,
                $other->latitude,
                $other->longitude
            );

            // Filter radius jika koordinat user saat ini tersedia
            if ($currentUser->latitude && $currentUser->longitude) {
                if ($dist !== null && $dist <= $radiusKm) {
                    $friendship = BlipFriendship::where(function ($q) use ($currentUser, $other) {
                        $q->where('user_id', $currentUser->id)->where('friend_id', $other->id);
                    })->orWhere(function ($q) use ($currentUser, $other) {
                        $q->where('user_id', $other->id)->where('friend_id', $currentUser->id);
                    })->first();

                    $friendshipStatus = 'none';
                    $friendshipInitiator = null;
                    if ($friendship) {
                        $friendshipStatus = $friendship->status; // pending, accepted
                        $friendshipInitiator = $friendship->user_id;
                    }

                    $nearby[] = [
                        'id' => $other->id,
                        'name' => $other->name,
                        'username' => $other->username,
                        'gender' => $other->gender,
                        'age' => $other->calculated_age,
                        'bio' => $other->bio,
                        'avatar_color' => $other->avatar_color,
                        'avatar_url' => $other->avatar_url,
                        'distance_km' => $dist,
                        'distance_formatted' => $dist < 1 ? round($dist * 1000) . ' m' : $dist . ' km',
                        'last_active' => $other->last_active_at ? $other->last_active_at->diffForHumans() : 'Baru saja',
                        'friendship_status' => $friendshipStatus,
                        'friendship_initiator' => $friendshipInitiator,
                        'friendship_id' => $friendship ? $friendship->id : null,
                    ];
                }
            } else {
                // Koordinat belum diaktifkan
                $nearby[] = [
                    'id' => $other->id,
                    'name' => $other->name,
                    'username' => $other->username,
                    'gender' => $other->gender,
                    'age' => $other->calculated_age,
                    'bio' => $other->bio,
                    'avatar_color' => $other->avatar_color,
                    'avatar_url' => $other->avatar_url,
                    'distance_km' => null,
                    'distance_formatted' => 'Lokasi belum aktif',
                    'last_active' => $other->last_active_at ? $other->last_active_at->diffForHumans() : 'Baru saja',
                    'friendship_status' => 'none',
                    'friendship_initiator' => null,
                    'friendship_id' => null,
                ];
            }
        }

        // Urutkan dari yang terdekat
        usort($nearby, function ($a, $b) {
            if ($a['distance_km'] === null) return 1;
            if ($b['distance_km'] === null) return -1;
            return $a['distance_km'] <=> $b['distance_km'];
        });

        $totalCount = count($nearby);
        $offset = ($page - 1) * $limit;
        $paginatedNearby = array_slice($nearby, $offset, $limit);
        $hasMore = ($offset + $limit) < $totalCount;

        return response()->json([
            'status' => 'success',
            'current_user' => $currentUser,
            'nearby' => $paginatedNearby,
            'page' => $page,
            'limit' => $limit,
            'total' => $totalCount,
            'has_more' => $hasMore,
            'radius_km' => $radiusKm,
        ]);
    }

    /**
     * Kirim Friend Request (Add Teman)
     */
    public function sendFriendRequest(Request $request)
    {
        $currentUser = $this->resolveUser($request);
        $request->validate([
            'target_user_id' => 'required|exists:blip_users,id',
        ]);

        $targetUserId = $request->target_user_id;
        if ($targetUserId == $currentUser->id) {
            return response()->json(['status' => 'error', 'message' => 'Tidak bisa add diri sendiri.'], 400);
        }

        // Cek jarak terlebih dahulu, harus ada di sekitar
        $targetUser = BlipUser::findOrFail($targetUserId);
        $dist = $this->calculateDistance($currentUser->latitude, $currentUser->longitude, $targetUser->latitude, $targetUser->longitude);

        if ($dist !== null && $dist > 15) { // batas toleransi radius misal 15km
            return response()->json(['status' => 'error', 'message' => 'Pengguna berada di luar jangkauan area Anda.'], 400);
        }

        $existing = BlipFriendship::where(function ($q) use ($currentUser, $targetUserId) {
            $q->where('user_id', $currentUser->id)->where('friend_id', $targetUserId);
        })->orWhere(function ($q) use ($currentUser, $targetUserId) {
            $q->where('user_id', $targetUserId)->where('friend_id', $currentUser->id);
        })->first();

        if ($existing) {
            if ($existing->status === 'accepted') {
                return response()->json(['status' => 'success', 'message' => 'Kalian sudah berteman.', 'friendship' => $existing]);
            }
            if ($existing->user_id == $currentUser->id) {
                return response()->json(['status' => 'pending', 'message' => 'Permintaan pertemanan sudah dikirim sebelumnya.', 'friendship' => $existing]);
            } else {
                // Auto accept jika pihak lawan yang request
                $existing->update(['status' => 'accepted']);
                try {
                    broadcast(new FriendNotification($targetUserId, 'request_accepted', $currentUser));
                } catch (\Throwable $e) {}
                return response()->json(['status' => 'accepted', 'message' => 'Permintaan pertemanan diterima!', 'friendship' => $existing]);
            }
        }

        $friendship = BlipFriendship::create([
            'user_id' => $currentUser->id,
            'friend_id' => $targetUserId,
            'status' => 'pending',
        ]);

        try {
            broadcast(new FriendNotification($targetUserId, 'request_received', $currentUser));
        } catch (\Throwable $e) {}

        return response()->json([
            'status' => 'success',
            'message' => 'Permintaan pertemanan terkirim!',
            'friendship' => $friendship,
        ]);
    }

    /**
     * Respond Friend Request (Accept / Reject)
     */
    public function respondFriendRequest(Request $request)
    {
        $currentUser = $this->resolveUser($request);
        $request->validate([
            'friendship_id' => 'required|exists:blip_friendships,id',
            'action' => 'required|in:accept,reject',
        ]);

        $friendship = BlipFriendship::findOrFail($request->friendship_id);

        if ($friendship->friend_id != $currentUser->id) {
            return response()->json(['status' => 'error', 'message' => 'Akses ditolak.'], 403);
        }

        if ($request->action === 'accept') {
            $friendship->update(['status' => 'accepted']);
            try {
                broadcast(new FriendNotification($friendship->user_id, 'request_accepted', $currentUser));
            } catch (\Throwable $e) {}
            return response()->json(['status' => 'success', 'message' => 'Pertemanan diterima.']);
        } else {
            $targetUserId = $friendship->user_id;
            $friendship->delete();
            try {
                broadcast(new FriendNotification($targetUserId, 'request_rejected', $currentUser));
            } catch (\Throwable $e) {}
            return response()->json(['status' => 'success', 'message' => 'Permintaan pertemanan ditolak.']);
        }
    }

    /**
     * Hapus Hubungan Pertemanan (Unfriend)
     */
    public function removeFriend(Request $request, $friendId)
    {
        $currentUser = $this->resolveUser($request);

        $deleted = BlipFriendship::where(function ($q) use ($currentUser, $friendId) {
            $q->where('user_id', $currentUser->id)->where('friend_id', $friendId);
        })->orWhere(function ($q) use ($currentUser, $friendId) {
            $q->where('user_id', $friendId)->where('friend_id', $currentUser->id);
        })->delete();

        if ($deleted) {
            // Hapus seluruh file media gambar yang dikirim di antara kedua pengguna
            $mediaMessages = BlipMessage::where(function ($q) use ($currentUser, $friendId) {
                $q->where('sender_id', $currentUser->id)->where('receiver_id', $friendId);
            })->orWhere(function ($q) use ($currentUser, $friendId) {
                $q->where('sender_id', $friendId)->where('receiver_id', $currentUser->id);
            })->whereNotNull('photo_path')->get();

            foreach ($mediaMessages as $msg) {
                if ($msg->photo_path && \Illuminate\Support\Facades\Storage::disk('public')->exists($msg->photo_path)) {
                    \Illuminate\Support\Facades\Storage::disk('public')->delete($msg->photo_path);
                }
            }

            // Hapus permanen seluruh riwayat chat dari DB
            BlipMessage::where(function ($q) use ($currentUser, $friendId) {
                $q->where('sender_id', $currentUser->id)->where('receiver_id', $friendId);
            })->orWhere(function ($q) use ($currentUser, $friendId) {
                $q->where('sender_id', $friendId)->where('receiver_id', $currentUser->id);
            })->delete();

            // Broadcast ke teman yang di-unfriend secara realtime via Reverb
            try {
                broadcast(new FriendNotification((int) $friendId, 'friend_removed', $currentUser));
            } catch (\Throwable $e) {}

            return response()->json([
                'status' => 'success',
                'message' => 'Teman dan seluruh riwayat chat berhasil dihapus dari database.',
            ]);
        }

        return response()->json([
            'status' => 'error',
            'message' => 'Hubungan pertemanan tidak ditemukan.',
        ], 404);
    }

    /**
     * Daftar Teman yang sudah saling Add & Pending Requests
     */
    public function getFriendsAndRequests(Request $request)
    {
        $currentUser = $this->resolveUser($request);

        // Pertemanan yang sudah accepted
        $friendships = BlipFriendship::where('status', 'accepted')
            ->where(function ($q) use ($currentUser) {
                $q->where('user_id', $currentUser->id)
                  ->orWhere('friend_id', $currentUser->id);
            })->get();

        $friends = [];
        foreach ($friendships as $f) {
            $friendUser = $f->user_id == $currentUser->id ? $f->friend : $f->user;
            if (!$friendUser) continue;

            $dist = $this->calculateDistance($currentUser->latitude, $currentUser->longitude, $friendUser->latitude, $friendUser->longitude);

            // Cek pesan terakhir (yang belum dihapus oleh currentUser)
            $lastMsg = BlipMessage::where(function ($q) use ($currentUser, $friendUser) {
                $q->where(function ($sub) use ($currentUser, $friendUser) {
                    $sub->where('sender_id', $currentUser->id)
                        ->where('receiver_id', $friendUser->id)
                        ->where('deleted_by_sender', false);
                })->orWhere(function ($sub) use ($currentUser, $friendUser) {
                    $sub->where('sender_id', $friendUser->id)
                        ->where('receiver_id', $currentUser->id)
                        ->where('deleted_by_receiver', false);
                });
            })->latest()->first();

            $lastMessageSnippet = null;
            if ($lastMsg) {
                if ($lastMsg->type === 'image') {
                    $lastMessageSnippet = '📷 [Foto]';
                    if (!empty($lastMsg->message) && !str_starts_with($lastMsg->message, '[BLIP_P2P_IMAGE:')) {
                        $lastMessageSnippet .= ' ' . $lastMsg->message;
                    }
                } else if (!empty($lastMsg->message) && str_starts_with($lastMsg->message, '[BLIP_P2P_IMAGE:')) {
                    $lastMessageSnippet = '📷 [Foto]';
                } else {
                    $lastMessageSnippet = $lastMsg->message;
                }
            }

            // Unread count
            $unreadCount = BlipMessage::where('sender_id', $friendUser->id)
                ->where('receiver_id', $currentUser->id)
                ->where('is_read', false)
                ->count();

            $friends[] = [
                'friendship_id' => $f->id,
                'id' => $friendUser->id,
                'name' => $friendUser->name,
                'username' => $friendUser->username,
                'gender' => $friendUser->gender,
                'age' => $friendUser->calculated_age,
                'bio' => $friendUser->bio,
                'avatar_color' => $friendUser->avatar_color,
                'avatar_url' => $friendUser->avatar_url,
                'distance_formatted' => $dist !== null ? ($dist < 1 ? round($dist * 1000) . ' m' : $dist . ' km') : '-',
                'last_message' => $lastMessageSnippet,
                'last_message_is_me' => $lastMsg ? ($lastMsg->sender_id == $currentUser->id) : false,
                'last_message_time' => $lastMsg ? $lastMsg->created_at->format('H:i') : null,
                'unread_count' => $unreadCount,
            ];
        }

        // Permintaan masuk (incoming pending requests)
        $incomingRequests = BlipFriendship::where('status', 'pending')
            ->where('friend_id', $currentUser->id)
            ->with('user')
            ->get()
            ->map(function ($req) use ($currentUser) {
                $u = $req->user;
                $dist = $this->calculateDistance($currentUser->latitude, $currentUser->longitude, $u->latitude, $u->longitude);
                return [
                    'friendship_id' => $req->id,
                    'user_id' => $u->id,
                    'name' => $u->name,
                    'username' => $u->username,
                    'gender' => $u->gender,
                    'age' => $u->calculated_age,
                    'bio' => $u->bio,
                    'avatar_color' => $u->avatar_color,
                    'avatar_url' => $u->avatar_url,
                    'distance_formatted' => $dist !== null ? ($dist < 1 ? round($dist * 1000) . ' m' : $dist . ' km') : '-',
                    'created_at' => $req->created_at->diffForHumans(),
                ];
            });

        return response()->json([
            'status' => 'success',
            'friends' => $friends,
            'incoming_requests' => $incomingRequests,
        ]);
    }

    /**
     * Ambil Pesan Chat dengan Teman (Hanya jika sudah saling add / accepted)
     */
    public function getMessages(Request $request, $friendId)
    {
        $currentUser = $this->resolveUser($request);

        // Verifikasi apakah sudah saling add (accepted friendship)
        $isFriend = BlipFriendship::where('status', 'accepted')
            ->where(function ($q) use ($currentUser, $friendId) {
                $q->where('user_id', $currentUser->id)->where('friend_id', $friendId);
            })->orWhere(function ($q) use ($currentUser, $friendId) {
                $q->where('user_id', $friendId)->where('friend_id', $currentUser->id);
            })->exists();

        if (!$isFriend) {
            return response()->json([
                'status' => 'error',
                'message' => 'Anda harus saling berteman (saling add) terlebih dahulu untuk bisa chattingan.',
            ], 403);
        }

        $friend = BlipUser::findOrFail($friendId);

        // Tandai pesan terbaca
        $markedReadCount = BlipMessage::where('sender_id', $friendId)
            ->where('receiver_id', $currentUser->id)
            ->where('is_read', false)
            ->update(['is_read' => true]);

        if ($markedReadCount > 0) {
            try {
                broadcast(new MessagesRead($currentUser->id, (int) $friendId));
            } catch (\Throwable $e) {}
        }

        // Ambil pesan yang belum dihapus oleh currentUser
        $messages = BlipMessage::where(function ($q) use ($currentUser, $friendId) {
            $q->where(function ($sub) use ($currentUser, $friendId) {
                $sub->where('sender_id', $currentUser->id)
                    ->where('receiver_id', $friendId)
                    ->where('deleted_by_sender', false);
            })->orWhere(function ($sub) use ($currentUser, $friendId) {
                $sub->where('sender_id', $friendId)
                    ->where('receiver_id', $currentUser->id)
                    ->where('deleted_by_receiver', false);
            });
        })->orderBy('created_at', 'asc')->get();

        $dist = $this->calculateDistance($currentUser->latitude, $currentUser->longitude, $friend->latitude, $friend->longitude);

        return response()->json([
            'status' => 'success',
            'friend' => [
                'id' => $friend->id,
                'name' => $friend->name,
                'username' => $friend->username,
                'avatar_color' => $friend->avatar_color,
                'avatar_url' => $friend->avatar_url,
                'gender' => $friend->gender,
                'age' => $friend->calculated_age,
                'bio' => $friend->bio,
                'distance_formatted' => $dist !== null ? ($dist < 1 ? round($dist * 1000) . ' m' : $dist . ' km') : '-',
            ],
            'messages' => $messages->map(function ($m) use ($currentUser) {
                $isExpired = false;
                if ($m->type === 'image' && $m->expires_at && now()->greaterThan($m->expires_at) && !$m->is_saved) {
                    $isExpired = true;
                    // Hapus file fisik jika sudah kedaluwarsa dan belum disimpan
                    if ($m->photo_path && \Illuminate\Support\Facades\Storage::disk('public')->exists($m->photo_path)) {
                        \Illuminate\Support\Facades\Storage::disk('public')->delete($m->photo_path);
                        $m->update(['photo_path' => null]);
                    }
                }

                return [
                    'id' => $m->id,
                    'sender_id' => $m->sender_id,
                    'is_me' => $m->sender_id == $currentUser->id,
                    'type' => $m->type ?? 'text',
                    'message' => $m->message,
                    'photo_url' => ($m->photo_path && !$isExpired) ? asset('storage/' . $m->photo_path) : null,
                    'photo_size' => $m->photo_size,
                    'is_saved' => (bool) $m->is_saved,
                    'is_expired' => $isExpired,
                    'expires_at' => $m->expires_at ? $m->expires_at->toIso8601String() : null,
                    'is_read' => (bool) $m->is_read,
                    'time' => $m->created_at->format('H:i'),
                    'created_at' => $m->created_at->toIso8601String(),
                ];
            }),
        ]);
    }

    /**
     * Tandai Pesan sebagai Dibaca (Mark As Read)
     */
    public function markAsRead(Request $request, $friendId)
    {
        $currentUser = $this->resolveUser($request);

        $marked = BlipMessage::where('sender_id', $friendId)
            ->where('receiver_id', $currentUser->id)
            ->where('is_read', false)
            ->update(['is_read' => true]);

        if ($marked > 0) {
            try {
                broadcast(new MessagesRead($currentUser->id, (int) $friendId));
            } catch (\Throwable $e) {}
        }

        return response()->json([
            'status' => 'success',
            'marked_count' => $marked,
        ]);
    }

    /**
     * Kirim Pesan Chat ke Teman
     */
    public function sendMessage(Request $request, $friendId)
    {
        $currentUser = $this->resolveUser($request);

        // Verifikasi pertemanan accepted
        $isFriend = BlipFriendship::where('status', 'accepted')
            ->where(function ($q) use ($currentUser, $friendId) {
                $q->where('user_id', $currentUser->id)->where('friend_id', $friendId);
            })->orWhere(function ($q) use ($currentUser, $friendId) {
                $q->where('user_id', $friendId)->where('friend_id', $currentUser->id);
            })->exists();

        if (!$isFriend) {
            return response()->json([
                'status' => 'error',
                'message' => 'Anda harus saling berteman terlebih dahulu untuk mengirim pesan.',
            ], 403);
        }

        $request->validate([
            'message' => 'required|string|max:1000',
        ]);

        $message = BlipMessage::create([
            'sender_id' => $currentUser->id,
            'receiver_id' => $friendId,
            'message' => trim($request->message),
        ]);

        try {
            broadcast(new MessageSent($message));
        } catch (\Throwable $e) {}

        return response()->json([
            'status' => 'success',
            'message' => [
                'id' => $message->id,
                'sender_id' => $message->sender_id,
                'is_me' => true,
                'message' => $message->message,
                'is_read' => false,
                'time' => $message->created_at->format('H:i'),
                'created_at' => $message->created_at->toIso8601String(),
            ],
        ]);
    }

    /**
     * Hapus Satu Pesan (Untuk Saya Saja)
     */
    public function deleteSingleMessage(Request $request, $messageId)
    {
        $currentUser = $this->resolveUser($request);
        $message = BlipMessage::findOrFail($messageId);

        if ($message->sender_id == $currentUser->id) {
            $message->update(['deleted_by_sender' => true]);
        } elseif ($message->receiver_id == $currentUser->id) {
            $message->update(['deleted_by_receiver' => true]);
        } else {
            return response()->json(['status' => 'error', 'message' => 'Akses ditolak.'], 403);
        }

        // Jika kedua belah pihak sudah menghapus pesan ini, hapus permanen dari DB untuk hemat storage
        if ($message->deleted_by_sender && $message->deleted_by_receiver) {
            $message->delete();
        }

        return response()->json([
            'status' => 'success',
            'message' => 'Pesan berhasil dihapus dari tampilan Anda.',
            'message_id' => $messageId,
        ]);
    }

    /**
     * Hapus Banyak Pesan Terpilih (Bulk Delete - Untuk Saya Saja)
     */
    public function bulkDeleteMessages(Request $request)
    {
        $currentUser = $this->resolveUser($request);
        $request->validate([
            'message_ids' => 'required|array',
            'message_ids.*' => 'integer',
        ]);

        $ids = $request->message_ids;
        if (empty($ids)) {
            return response()->json(['status' => 'success', 'deleted_count' => 0]);
        }

        // Tandai pesan yang dikirim oleh currentUser
        BlipMessage::whereIn('id', $ids)
            ->where('sender_id', $currentUser->id)
            ->update(['deleted_by_sender' => true]);

        // Tandai pesan yang diterima oleh currentUser
        BlipMessage::whereIn('id', $ids)
            ->where('receiver_id', $currentUser->id)
            ->update(['deleted_by_receiver' => true]);

        // Hapus permanen dari DB jika kedua belah pihak sudah menghapus
        BlipMessage::whereIn('id', $ids)
            ->where('deleted_by_sender', true)
            ->where('deleted_by_receiver', true)
            ->delete();

        return response()->json([
            'status' => 'success',
            'message' => count($ids) . ' pesan berhasil dihapus dari tampilan Anda.',
            'message_ids' => $ids,
        ]);
    }

    /**
     * Bersihkan Seluruh Obrolan / Clear Chat (Untuk Saya Saja)
     */
    public function clearChat(Request $request, $friendId)
    {
        $currentUser = $this->resolveUser($request);

        // Tandai hapus semua pesan yang dikirim oleh currentUser ke friendId
        BlipMessage::where('sender_id', $currentUser->id)
            ->where('receiver_id', $friendId)
            ->update(['deleted_by_sender' => true]);

        // Tandai hapus semua pesan yang diterima currentUser dari friendId
        BlipMessage::where('sender_id', $friendId)
            ->where('receiver_id', $currentUser->id)
            ->update(['deleted_by_receiver' => true]);

        // Hapus permanen pesan yang sudah dihapus oleh kedua belah pihak
        BlipMessage::where('deleted_by_sender', true)
            ->where('deleted_by_receiver', true)
            ->delete();

        return response()->json([
            'status' => 'success',
            'message' => 'Riwayat obrolan berhasil dibersihkan.',
        ]);
    }

    /**
     * Kirim Pesan Foto (Compress ke ~100KB dan expired dalam 1 jam jika tidak disimpan)
     */
    public function sendPhotoMessage(Request $request, $friendId)
    {
        $currentUser = $this->resolveUser($request);

        $isFriend = BlipFriendship::where('status', 'accepted')
            ->where(function ($q) use ($currentUser, $friendId) {
                $q->where('user_id', $currentUser->id)->where('friend_id', $friendId);
            })->orWhere(function ($q) use ($currentUser, $friendId) {
                $q->where('user_id', $friendId)->where('friend_id', $currentUser->id);
            })->exists();

        if (!$isFriend) {
            return response()->json([
                'status' => 'error',
                'message' => 'Anda harus saling berteman untuk mengirim foto.',
            ], 403);
        }

        $validator = \Illuminate\Support\Facades\Validator::make($request->all(), [
            'photo' => 'required|file|max:25600', // max 25MB input
            'caption' => 'nullable|string|max:255',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'status' => 'error',
                'message' => $validator->errors()->first(),
                'errors' => $validator->errors(),
            ], 422);
        }

        $file = $request->file('photo');
        if (!$file || !$file->isValid()) {
            return response()->json([
                'status' => 'error',
                'message' => 'File foto tidak valid atau gagal diunggah.',
            ], 422);
        }
        $fileName = 'blip_' . uniqid() . '_' . time() . '.jpg';
        $relativeDir = 'photos/' . date('Y/m/d');
        $storageDir = storage_path('app/public/' . $relativeDir);

        if (!file_exists($storageDir)) {
            mkdir($storageDir, 0755, true);
        }

        $targetPath = $storageDir . '/' . $fileName;

        // Kompresi gambar via GD ke target ~100KB
        $this->compressImageToTargetSize($file->getPathname(), $targetPath, 100 * 1024);

        $savedSize = file_exists($targetPath) ? filesize($targetPath) : $file->getSize();
        $relativePhotoPath = $relativeDir . '/' . $fileName;

        $message = BlipMessage::create([
            'sender_id' => $currentUser->id,
            'receiver_id' => $friendId,
            'type' => 'image',
            'message' => trim($request->caption ?? ''),
            'photo_path' => $relativePhotoPath,
            'photo_size' => $savedSize,
            'is_saved' => false,
            'expires_at' => now()->addHour(), // Hilang dalam 1 jam jika tidak disimpan
        ]);

        try {
            broadcast(new MessageSent($message));
        } catch (\Throwable $e) {}

        return response()->json([
            'status' => 'success',
            'message' => [
                'id' => $message->id,
                'sender_id' => $message->sender_id,
                'is_me' => true,
                'type' => 'image',
                'message' => $message->message,
                'photo_url' => asset('storage/' . $message->photo_path),
                'photo_size' => $message->photo_size,
                'is_saved' => false,
                'is_expired' => false,
                'expires_at' => $message->expires_at->toIso8601String(),
                'is_read' => false,
                'time' => $message->created_at->format('H:i'),
                'created_at' => $message->created_at->toIso8601String(),
            ],
        ]);
    }

    /**
     * Simpan Foto Permanen oleh Penerima/Pengirim (Mencegah terhapus setelah 1 jam)
     */
    public function savePhotoMessage(Request $request, $messageId)
    {
        $currentUser = $this->resolveUser($request);
        $message = BlipMessage::where('id', $messageId)
            ->where(function ($q) use ($currentUser) {
                $q->where('sender_id', $currentUser->id)
                  ->orWhere('receiver_id', $currentUser->id);
            })->firstOrFail();

        if ($message->type !== 'image' || !$message->photo_path) {
            return response()->json(['status' => 'error', 'message' => 'Pesan bukan berupa foto.'], 400);
        }

        if ($message->expires_at && now()->greaterThan($message->expires_at) && !$message->is_saved) {
            return response()->json(['status' => 'error', 'message' => 'Foto sudah kedaluwarsa.'], 410);
        }

        $message->update([
            'is_saved' => true,
            'expires_at' => null, // Bebas dari penghapusan otomatis 1 jam
        ]);

        return response()->json([
            'status' => 'success',
            'message' => 'Foto berhasil disimpan permanen!',
            'photo_url' => asset('storage/' . $message->photo_path),
        ]);
    }

    /**
     * Helper: Kompresi foto secara cerdas hingga ukuran ~100 KB
     */
    private function compressImageToTargetSize(string $sourcePath, string $destinationPath, int $targetBytes = 102400): void
    {
        $info = getimagesize($sourcePath);
        if (!$info) {
            copy($sourcePath, $destinationPath);
            return;
        }

        $mime = $info['mime'];
        switch ($mime) {
            case 'image/jpeg':
                $image = @imagecreatefromjpeg($sourcePath);
                break;
            case 'image/png':
                $image = @imagecreatefrompng($sourcePath);
                break;
            case 'image/webp':
                $image = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($sourcePath) : null;
                break;
            case 'image/gif':
                $image = @imagecreatefromgif($sourcePath);
                break;
            default:
                $image = null;
        }

        if (!$image) {
            copy($sourcePath, $destinationPath);
            return;
        }

        $origWidth = imagesx($image);
        $origHeight = imagesy($image);

        // Batasi dimensi maksimum (misal maks lebar/tinggi 1280px)
        $maxDim = 1280;
        $width = $origWidth;
        $height = $origHeight;

        if ($origWidth > $maxDim || $origHeight > $maxDim) {
            if ($origWidth >= $origHeight) {
                $width = $maxDim;
                $height = (int) round(($origHeight / $origWidth) * $maxDim);
            } else {
                $height = $maxDim;
                $width = (int) round(($origWidth / $origHeight) * $maxDim);
            }
        }

        $resized = imagecreatetruecolor($width, $height);
        imagealphablending($resized, false);
        imagesavealpha($resized, true);
        imagecopyresampled($resized, $image, 0, 0, 0, 0, $width, $height, $origWidth, $origHeight);

        // Binary search / tuning kualitas JPEG agar ukuran mendekati ~100 KB
        $quality = 75;
        imagejpeg($resized, $destinationPath, $quality);

        $fileSize = filesize($destinationPath);
        if ($fileSize > $targetBytes) {
            // Turunkan bertahap sampai mendekati target 100KB
            for ($q = 65; $q >= 30; $q -= 10) {
                imagejpeg($resized, $destinationPath, $q);
                if (filesize($destinationPath) <= $targetBytes * 1.15) {
                    break;
                }
            }
        }

        imagedestroy($image);
        imagedestroy($resized);
    }

    public function seedNearbyDemoUsers(Request $request)
    {
        $currentUser = $this->resolveUser($request);
        $baseLat = $currentUser->latitude ?? -6.2538;
        $baseLon = $currentUser->longitude ?? 106.8206;

        $demoProfiles = [
            ['name' => 'Dimas Mampang', 'username' => 'dimas_mampang', 'color' => '#10b981', 'loc' => 'Mampang Prapatan IV', 'dlat' => 0.003, 'dlon' => 0.002],
            ['name' => 'Rina Kemang', 'username' => 'rina_kemang', 'color' => '#f43f5e', 'loc' => 'Jl. Bangka Raya', 'dlat' => -0.005, 'dlon' => 0.004],
            ['name' => 'Budi Duren Tiga', 'username' => 'budi_duren3', 'color' => '#06b6d4', 'loc' => 'Duren Tiga Selatan', 'dlat' => 0.007, 'dlon' => -0.003],
            ['name' => 'Siti Tendean', 'username' => 'siti_tendean', 'color' => '#f59e0b', 'loc' => 'Jl. Kapten Tendean', 'dlat' => -0.008, 'dlon' => -0.004],
        ];

        foreach ($demoProfiles as $p) {
            $demoUser = BlipUser::firstOrCreate(
                ['name' => $p['name']],
                [
                    'username' => $p['username'],
                    'session_token' => (string) Str::uuid(),
                    'avatar_color' => $p['color'],
                    'latitude' => $baseLat + $p['dlat'],
                    'longitude' => $baseLon + $p['dlon'],
                    'location_name' => $p['loc'],
                    'last_active_at' => Carbon::now(),
                ]
            );
            $demoUser->update([
                'username' => $demoUser->username ?: $p['username'],
                'latitude' => $baseLat + $p['dlat'],
                'longitude' => $baseLon + $p['dlon'],
                'last_active_at' => Carbon::now(),
            ]);
        }

        return response()->json([
            'status' => 'success',
            'message' => 'User simulasi sekitar Mampang berhasil diaktifkan untuk demo!',
        ]);
    }
}
