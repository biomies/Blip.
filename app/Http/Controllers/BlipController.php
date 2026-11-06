<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\BlipUser;
use App\Models\BlipFriendship;
use App\Models\BlipMessage;
use App\Models\BlipThread;
use App\Models\BlipThreadReply;
use App\Models\BlipThreadLike;
use App\Models\BlipNotification;
use Illuminate\Support\Str;
use Carbon\Carbon;
use App\Events\MessageSent;
use App\Events\FriendNotification;
use App\Events\ThreadNotification;
use App\Events\MessagesRead;
use App\Events\WebRtcSignal;
use Illuminate\Support\Facades\Cache;

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
            'latitude' => 'nullable|numeric',
            'longitude' => 'nullable|numeric',
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

        // Cari user yang sudah onboarded, aktif dalam 24 jam terakhir, dan bukan diri sendiri
        $activeCutoff = Carbon::now()->subHours(24);
        $query = BlipUser::where('id', '!=', $currentUser->id)
            ->where('is_onboarded', true)
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

        // Cek jarak: pengguna di sekitar (atau ditambahkan melalui pencarian Knot/Radar)
        $targetUser = BlipUser::findOrFail($targetUserId);
        $dist = $this->calculateDistance($currentUser->latitude, $currentUser->longitude, $targetUser->latitude, $targetUser->longitude);

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
        // Jika ekstensi GD tidak tersedia di PHP, langsung simpan file aslinya
        if (!function_exists('imagecreatefromjpeg') && !function_exists('imagecreatefrompng')) {
            copy($sourcePath, $destinationPath);
            return;
        }

        $info = @getimagesize($sourcePath);
        if (!$info) {
            copy($sourcePath, $destinationPath);
            return;
        }

        $mime = $info['mime'];
        $image = null;
        switch ($mime) {
            case 'image/jpeg':
                $image = function_exists('imagecreatefromjpeg') ? @imagecreatefromjpeg($sourcePath) : null;
                break;
            case 'image/png':
                $image = function_exists('imagecreatefrompng') ? @imagecreatefrompng($sourcePath) : null;
                break;
            case 'image/webp':
                $image = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($sourcePath) : null;
                break;
            case 'image/gif':
                $image = function_exists('imagecreatefromgif') ? @imagecreatefromgif($sourcePath) : null;
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

    /**
     * Format jarak numerik (km) menjadi string ringkas (misal: 150 m atau 2.4 km)
     */
    private function formatDistanceText($dist): string
    {
        if ($dist === null) {
            return 'Lokasi tidak aktif';
        }
        if ($dist < 0.05) {
            return '0 m';
        }
        return $dist < 1 ? round($dist * 1000) . ' m' : round($dist, 1) . ' km';
    }

    /**
     * Dapatkan daftar thread terbaru dengan jarak relatif dari lokasi user saat ini
     * (Menggunakan Cursor-based Infinite Scroll, Bounding Box Indexing, dan Cached Feed)
     */
    public function getThreads(Request $request)
    {
        $currentUser = $this->resolveUser($request);

        $userLat = $request->latitude !== null ? floatval($request->latitude) : $currentUser->latitude;
        $userLon = $request->longitude !== null ? floatval($request->longitude) : $currentUser->longitude;
        $cursor = $request->query('cursor') ? (int) $request->query('cursor') : null;
        $limit = min(50, max(5, (int) $request->query('limit', 15)));
        $search = trim($request->query('search', ''));
        $radiusKm = (float) $request->query('radius', 50); // Bounding box default 50km

        // Buat cache key jika request adalah query awal (tanpa filter pencarian dan tanpa cursor)
        $isFirstPublicFeed = empty($search) && empty($cursor);
        $roundedLat = $userLat !== null ? round($userLat, 2) : 0;
        $roundedLon = $userLon !== null ? round($userLon, 2) : 0;
        $cacheKey = "blip_knot_feed_{$roundedLat}_{$roundedLon}_{$limit}";

        if ($isFirstPublicFeed) {
            $cachedThreads = Cache::get($cacheKey);
            if ($cachedThreads) {
                // Ambil daftar like khusus untuk currentUser dari database secara cepat
                $threadIds = collect($cachedThreads)->pluck('id')->toArray();
                $myLikes = BlipThreadLike::where('user_id', $currentUser->id)
                    ->whereIn('thread_id', $threadIds)
                    ->pluck('thread_id')
                    ->flip()
                    ->toArray();

                $data = array_map(function ($t) use ($currentUser, $myLikes) {
                    $t['is_liked'] = isset($myLikes[$t['id']]);
                    $t['is_mine'] = ($t['user_id'] === $currentUser->id);
                    return $t;
                }, $cachedThreads);

                $nextCursor = count($data) > 0 ? end($data)['id'] : null;

                return response()->json([
                    'status' => 'success',
                    'threads' => $data,
                    'next_cursor' => $nextCursor,
                    'has_more' => count($data) >= $limit,
                ]);
            }
        }

        $query = BlipThread::select([
            'id', 'user_id', 'content', 'latitude', 'longitude',
            'likes_count', 'replies_count', 'created_at'
        ])->with([
            'user:id,name,username,avatar_color,avatar_url,gender,birthdate,age',
            'likes' => function ($q) use ($currentUser) {
                // Eager loading scoped khusus user yang login & hanya ambil kolom thread_id, user_id untuk hemat RAM
                $q->select(['id', 'thread_id', 'user_id'])->where('user_id', $currentUser->id);
            }
        ]);

        // 1. Cursor-based Pagination (Query O(1) via Primary Key ID)
        if ($cursor) {
            $query->where('id', '<', $cursor);
        }

        // 2. Bounding Box Indexing untuk Jarak (menggunakan index latitude, longitude di MySQL)
        if ($userLat !== null && $userLon !== null && $radiusKm > 0) {
            $latDelta = ($radiusKm / 111.0);
            $cosLat = cos(deg2rad($userLat));
            $lonDelta = ($cosLat > 0.0001) ? ($radiusKm / (111.0 * $cosLat)) : ($radiusKm / 111.0);

            $minLat = $userLat - $latDelta;
            $maxLat = $userLat + $latDelta;
            $minLon = $userLon - $lonDelta;
            $maxLon = $userLon + $lonDelta;

            // Bounding box filter (menggunakan index lat-lon, atau knot tanpa koordinat tetap ditampilkan)
            $query->where(function ($sub) use ($minLat, $maxLat, $minLon, $maxLon) {
                $sub->whereBetween('latitude', [$minLat, $maxLat])
                    ->whereBetween('longitude', [$minLon, $maxLon])
                    ->orWhereNull('latitude');
            });
        }

        // Filter Pencarian Teks
        if (!empty($search)) {
            $qLower = strtolower($search);
            $query->where(function ($sub) use ($qLower) {
                $sub->where('content', 'like', "%{$qLower}%")
                    ->orWhereHas('user', function ($uQ) use ($qLower) {
                        $uQ->where('name', 'like', "%{$qLower}%")
                           ->orWhere('username', 'like', "%{$qLower}%");
                    });
            });
        }

        // Sorting: Jika koordinat user tersedia, hitung jarak Euclidean kuadrat di SQL untuk urutkan terdekat dulu, lalu terbaru (id DESC)
        if ($userLat !== null && $userLon !== null) {
            $cosLat = cos(deg2rad($userLat));
            // Ekspresi jarak aproksimasi cepat tanpa trigonometri berat: (lat - userLat)^2 + ((lon - userLon) * cosLat)^2
            // Knots dengan koordinat NULL ditaruh di akhir
            $query->orderByRaw("
                CASE WHEN latitude IS NULL OR longitude IS NULL THEN 1 ELSE 0 END ASC,
                (POWER(latitude - ?, 2) + POWER((longitude - ?) * ?, 2)) ASC,
                id DESC
            ", [$userLat, $userLon, $cosLat]);
        } else {
            $query->orderBy('id', 'desc');
        }

        $threads = $query->take($limit)->get();

        $data = $threads->map(function ($t) use ($userLat, $userLon, $currentUser) {
            $dist = $this->calculateDistance($userLat, $userLon, $t->latitude, $t->longitude);

            return [
                'id' => $t->id,
                'user_id' => $t->user_id,
                'content' => $t->content,
                'likes_count' => $t->likes_count,
                'replies_count' => $t->replies_count,
                'is_liked' => $t->likes->isNotEmpty(),
                'is_mine' => $t->user_id === $currentUser->id,
                'distance_km' => $dist,
                'distance_formatted' => $this->formatDistanceText($dist),
                'created_at_human' => $t->created_at ? $t->created_at->diffForHumans() : 'Baru saja',
                'created_at_time' => $t->created_at ? $t->created_at->format('H:i') : '',
                'user' => [
                    'id' => $t->user?->id,
                    'name' => $t->user?->name ?? 'Pengguna',
                    'username' => $t->user?->username ?? 'user',
                    'avatar_color' => $t->user?->avatar_color ?? '#4f46e5',
                    'avatar_url' => $t->user?->avatar_url,
                    'gender' => $t->user?->gender,
                    'age' => $t->user?->calculated_age,
                ],
            ];
        })->toArray();

        // Simpan cache publik selama 15 detik jika halaman pertama tanpa search
        if ($isFirstPublicFeed && count($data) > 0) {
            Cache::put($cacheKey, $data, 15);
        }

        $nextCursor = count($data) > 0 ? end($data)['id'] : null;
        $hasMore = count($data) >= $limit;

        return response()->json([
            'status' => 'success',
            'threads' => $data,
            'next_cursor' => $nextCursor,
            'has_more' => $hasMore,
        ]);
    }

    /**
     * Dapatkan daftar thread/knot khusus milik satu user (untuk profil bergaya Twitter)
     */
    public function getUserThreads(Request $request, $id)
    {
        $currentUser = $this->resolveUser($request);
        $user = BlipUser::find($id);

        if (!$user) {
            return response()->json([
                'status' => 'error',
                'message' => 'Pengguna tidak ditemukan.',
            ], 404);
        }

        $userLat = $request->latitude !== null ? floatval($request->latitude) : $currentUser->latitude;
        $userLon = $request->longitude !== null ? floatval($request->longitude) : $currentUser->longitude;
        $cursor = $request->query('cursor') ? (int) $request->query('cursor') : null;
        $limit = min(50, max(5, (int) $request->query('limit', 15)));

        $query = BlipThread::select([
            'id', 'user_id', 'content', 'latitude', 'longitude',
            'likes_count', 'replies_count', 'created_at'
        ])->where('user_id', $user->id)
          ->with([
            'user:id,name,username,avatar_color,avatar_url,gender,birthdate,age',
            'likes' => function ($q) use ($currentUser) {
                $q->select(['id', 'thread_id', 'user_id'])->where('user_id', $currentUser->id);
            }
        ]);

        if ($cursor) {
            $query->where('id', '<', $cursor);
        }

        $query->orderBy('id', 'desc');

        $threads = $query->take($limit)->get();

        $data = $threads->map(function ($t) use ($userLat, $userLon, $currentUser) {
            $dist = $this->calculateDistance($userLat, $userLon, $t->latitude, $t->longitude);

            return [
                'id' => $t->id,
                'user_id' => $t->user_id,
                'content' => $t->content,
                'likes_count' => $t->likes_count,
                'replies_count' => $t->replies_count,
                'is_liked' => $t->likes->isNotEmpty(),
                'is_mine' => $t->user_id === $currentUser->id,
                'distance_km' => $dist,
                'distance_formatted' => $this->formatDistanceText($dist),
                'created_at_human' => $t->created_at ? $t->created_at->diffForHumans() : 'Baru saja',
                'created_at_time' => $t->created_at ? $t->created_at->format('H:i') : '',
                'user' => [
                    'id' => $t->user?->id,
                    'name' => $t->user?->name ?? 'Pengguna',
                    'username' => $t->user?->username ?? 'user',
                    'avatar_color' => $t->user?->avatar_color ?? '#4f46e5',
                    'avatar_url' => $t->user?->avatar_url,
                    'gender' => $t->user?->gender,
                    'age' => $t->user?->calculated_age,
                ],
            ];
        })->toArray();

        $nextCursor = count($data) > 0 ? end($data)['id'] : null;
        $hasMore = count($data) >= $limit;

        return response()->json([
            'status' => 'success',
            'threads' => $data,
            'next_cursor' => $nextCursor,
            'has_more' => $hasMore,
        ]);
    }

    /**
     * Helper untuk menghapus cache feed publik knot saat ada postingan baru / dihapus
     */
    private function clearKnotFeedCache(?float $lat, ?float $lon)
    {
        if ($lat !== null && $lon !== null) {
            $roundedLat = round($lat, 2);
            $roundedLon = round($lon, 2);
            foreach ([10, 15, 20, 30, 50] as $lim) {
                Cache::forget("blip_knot_feed_{$roundedLat}_{$roundedLon}_{$lim}");
            }
        }
        // Bersihkan juga cache default koordinat 0_0
        foreach ([10, 15, 20, 30, 50] as $lim) {
            Cache::forget("blip_knot_feed_0_0_{$lim}");
        }
    }

    /**
     * Buat thread postingan baru
     */
    public function createThread(Request $request)
    {
        $currentUser = $this->resolveUser($request);

        $request->validate([
            'content' => 'required|string|max:1000',
            'latitude' => 'nullable|numeric',
            'longitude' => 'nullable|numeric',
        ], [
            'content.required' => 'Isi postingan tidak boleh kosong.',
            'content.max' => 'Maksimal 1000 karakter.',
        ]);

        $content = trim($request->content);

        // 1. Idempotency & Anti Double-Submit Protection (ala Twitter / Threads)
        // Cek apakah user yang sama baru saja memposting konten identik dalam 5 detik terakhir
        $idempotencyKey = 'idemp_thread_' . $currentUser->id . '_' . md5($content);
        if (Cache::has($idempotencyKey)) {
            // Ambil thread yang baru dibuat agar respon tetap sukses tanpa duplikasi data
            $existingId = Cache::get($idempotencyKey);
            $existingThread = BlipThread::with('user')->find($existingId);
            if ($existingThread) {
                return response()->json([
                    'status' => 'success',
                    'message' => 'Postingan knot berhasil dibuat!',
                    'thread' => $existingThread,
                ]);
            }
        }

        $lat = $request->latitude !== null ? floatval($request->latitude) : $currentUser->latitude;
        $lon = $request->longitude !== null ? floatval($request->longitude) : $currentUser->longitude;

        $thread = BlipThread::create([
            'user_id' => $currentUser->id,
            'content' => $content,
            'latitude' => $lat,
            'longitude' => $lon,
            'likes_count' => 0,
            'replies_count' => 0,
        ]);

        // Simpan kunci idempotensi selama 5 detik
        Cache::put($idempotencyKey, $thread->id, 5);

        $thread->load('user');
        $dist = $this->calculateDistance($lat, $lon, $thread->latitude, $thread->longitude);

        // Notifikasi Mention (@username) jika ada user yang di-tag di postingan thread
        $this->notifyMentionedUsers($thread->content, $currentUser, $thread->id, null);

        // Hapus cache feed publik terdekat agar knot baru langsung muncul saat refresh
        $this->clearKnotFeedCache($lat, $lon);

        return response()->json([
            'status' => 'success',
            'message' => 'Postingan thread berhasil dibuat!',
            'thread' => [
                'id' => $thread->id,
                'content' => $thread->content,
                'likes_count' => 0,
                'replies_count' => 0,
                'is_liked' => false,
                'is_mine' => true,
                'distance_km' => $dist,
                'distance_formatted' => '0 m',
                'created_at_human' => 'Baru saja',
                'created_at_time' => $thread->created_at->format('H:i'),
                'user' => [
                    'id' => $currentUser->id,
                    'name' => $currentUser->name,
                    'username' => $currentUser->username,
                    'avatar_color' => $currentUser->avatar_color,
                    'avatar_url' => $currentUser->avatar_url,
                    'gender' => $currentUser->gender,
                    'age' => $currentUser->calculated_age,
                ],
            ],
        ]);
    }

    /**
     * Dapatkan detail thread beserta seluruh daftar balasannya
     */
    public function getThreadDetail(Request $request, $id)
    {
        $currentUser = $this->resolveUser($request);

        $userLat = $request->latitude !== null ? floatval($request->latitude) : $currentUser->latitude;
        $userLon = $request->longitude !== null ? floatval($request->longitude) : $currentUser->longitude;

        $thread = BlipThread::select([
            'id', 'user_id', 'content', 'latitude', 'longitude',
            'likes_count', 'replies_count', 'created_at'
        ])->with([
            'user:id,name,username,avatar_color,avatar_url,gender,birthdate,age',
            'likes' => function ($q) use ($currentUser) {
                $q->select(['id', 'thread_id', 'user_id'])->where('user_id', $currentUser->id);
            },
            'replies' => function ($q) {
                $q->select(['id', 'thread_id', 'user_id', 'content', 'latitude', 'longitude', 'created_at']);
            },
            'replies.user:id,name,username,avatar_color,avatar_url,gender,birthdate,age'
        ])->findOrFail($id);

        $dist = $this->calculateDistance($userLat, $userLon, $thread->latitude, $thread->longitude);
        $isLiked = $thread->likes->isNotEmpty();

        $replies = $thread->replies->map(function ($r) use ($userLat, $userLon, $currentUser) {
            $replyDist = $this->calculateDistance($userLat, $userLon, $r->latitude, $r->longitude);

            return [
                'id' => $r->id,
                'content' => $r->content,
                'is_mine' => $r->user_id === $currentUser->id,
                'distance_km' => $replyDist,
                'distance_formatted' => $this->formatDistanceText($replyDist),
                'created_at_human' => $r->created_at ? $r->created_at->diffForHumans() : 'Baru saja',
                'created_at_time' => $r->created_at ? $r->created_at->format('H:i') : '',
                'user' => [
                    'id' => $r->user?->id,
                    'name' => $r->user?->name ?? 'Pengguna',
                    'username' => $r->user?->username ?? 'user',
                    'avatar_color' => $r->user?->avatar_color ?? '#4f46e5',
                    'avatar_url' => $r->user?->avatar_url,
                    'gender' => $r->user?->gender,
                    'age' => $r->user?->calculated_age,
                ],
            ];
        });

        return response()->json([
            'status' => 'success',
            'thread' => [
                'id' => $thread->id,
                'content' => $thread->content,
                'likes_count' => $thread->likes_count,
                'replies_count' => $thread->replies_count,
                'is_liked' => $isLiked,
                'is_mine' => $thread->user_id === $currentUser->id,
                'distance_km' => $dist,
                'distance_formatted' => $this->formatDistanceText($dist),
                'created_at_human' => $thread->created_at ? $thread->created_at->diffForHumans() : 'Baru saja',
                'created_at_time' => $thread->created_at ? $thread->created_at->format('H:i') : '',
                'user' => [
                    'id' => $thread->user?->id,
                    'name' => $thread->user?->name ?? 'Pengguna',
                    'username' => $thread->user?->username ?? 'user',
                    'avatar_color' => $thread->user?->avatar_color ?? '#4f46e5',
                    'avatar_url' => $thread->user?->avatar_url,
                    'gender' => $thread->user?->gender,
                    'age' => $thread->user?->calculated_age,
                ],
            ],
            'replies' => $replies,
        ]);
    }

    /**
     * Kirim balasan ke thread
     */
    public function replyThread(Request $request, $id)
    {
        $currentUser = $this->resolveUser($request);
        $thread = BlipThread::findOrFail($id);

        $request->validate([
            'content' => 'required|string|max:1000',
            'latitude' => 'nullable|numeric',
            'longitude' => 'nullable|numeric',
        ], [
            'content.required' => 'Balasan tidak boleh kosong.',
            'content.max' => 'Maksimal 1000 karakter.',
        ]);

        $content = trim($request->content);

        // Idempotency check untuk balasan (mencegah klik ganda tombol kirim balasan)
        $idempotencyKey = 'idemp_reply_' . $currentUser->id . '_' . $thread->id . '_' . md5($content);
        if (Cache::has($idempotencyKey)) {
            $existingId = Cache::get($idempotencyKey);
            $existingReply = BlipThreadReply::with('user')->find($existingId);
            if ($existingReply) {
                return response()->json([
                    'status' => 'success',
                    'message' => 'Balasan terkirim!',
                    'reply' => $existingReply,
                    'replies_count' => $thread->replies_count,
                ]);
            }
        }

        $lat = $request->latitude !== null ? floatval($request->latitude) : $currentUser->latitude;
        $lon = $request->longitude !== null ? floatval($request->longitude) : $currentUser->longitude;

        $reply = BlipThreadReply::create([
            'thread_id' => $thread->id,
            'user_id' => $currentUser->id,
            'content' => $content,
            'latitude' => $lat,
            'longitude' => $lon,
        ]);

        Cache::put($idempotencyKey, $reply->id, 5);

        $thread->increment('replies_count');
        $reply->load('user');

        // 1. Notifikasi ke pemilik utas (jika bukan membalas postingan sendiri)
        if ($thread->user_id !== $currentUser->id) {
            $notif = BlipNotification::createWithCap([
                'user_id' => $thread->user_id,
                'sender_id' => $currentUser->id,
                'type' => 'thread_reply',
                'thread_id' => $thread->id,
                'reply_id' => $reply->id,
                'preview_text' => Str::limit($reply->content, 80),
                'is_read' => false,
            ]);

            try {
                broadcast(new ThreadNotification(
                    $thread->user_id,
                    'thread_reply',
                    $thread->id,
                    $reply->id,
                    Str::limit($reply->content, 80),
                    $currentUser
                ));
            } catch (\Throwable $e) {}
        }

        // 2. Notifikasi Mention (@username) jika ada user yang di-tag di balasan (kecuali pembuat thread yang sudah dapat notif reply)
        $this->notifyMentionedUsers($reply->content, $currentUser, $thread->id, $reply->id, [$thread->user_id]);

        // Bersihkan cache feed publik knot terkait agar replies_count terupdate
        $this->clearKnotFeedCache($thread->latitude, $thread->longitude);

        $replyDist = $this->calculateDistance($lat, $lon, $reply->latitude, $reply->longitude);

        return response()->json([
            'status' => 'success',
            'message' => 'Balasan terkirim!',
            'reply' => [
                'id' => $reply->id,
                'content' => $reply->content,
                'is_mine' => true,
                'distance_km' => $replyDist,
                'distance_formatted' => '0 m',
                'created_at_human' => 'Baru saja',
                'created_at_time' => $reply->created_at->format('H:i'),
                'user' => [
                    'id' => $currentUser->id,
                    'name' => $currentUser->name,
                    'username' => $currentUser->username,
                    'avatar_color' => $currentUser->avatar_color,
                    'avatar_url' => $currentUser->avatar_url,
                    'gender' => $currentUser->gender,
                    'age' => $currentUser->calculated_age,
                ],
            ],
            'replies_count' => $thread->replies_count,
        ]);
    }

    /**
     * Toggle suka (like) pada thread
     */
    public function toggleLikeThread(Request $request, $id)
    {
        $currentUser = $this->resolveUser($request);
        $thread = BlipThread::findOrFail($id);

        $existing = BlipThreadLike::where('thread_id', $id)
            ->where('user_id', $currentUser->id)
            ->first();

        if ($existing) {
            $existing->delete();
            $isLiked = false;

            // Jika ada notifikasi like yang belum dibaca dari user ini untuk thread ini, hapus
            BlipNotification::where('user_id', $thread->user_id)
                ->where('sender_id', $currentUser->id)
                ->where('thread_id', $id)
                ->where('type', 'thread_like')
                ->where('is_read', false)
                ->delete();
        } else {
            BlipThreadLike::firstOrCreate([
                'thread_id' => $id,
                'user_id' => $currentUser->id,
            ]);
            $isLiked = true;

            // Buat Notifikasi ke pemilik postingan jika bukan menyukai postingan sendiri
            if ($thread->user_id !== $currentUser->id) {
                // Simpan notifikasi like dengan proteksi kapasitas maksimal
                BlipNotification::createWithCap([
                    'user_id' => $thread->user_id,
                    'sender_id' => $currentUser->id,
                    'type' => 'thread_like',
                    'thread_id' => $thread->id,
                    'reply_id' => null,
                    'preview_text' => Str::limit($thread->content, 80),
                    'is_read' => false,
                ]);

                // Hitung berapa total orang yang menyukai postingan ini yang belum dibaca notifikasinya
                $unreadLikesCount = BlipNotification::where('user_id', $thread->user_id)
                    ->where('thread_id', $thread->id)
                    ->where('type', 'thread_like')
                    ->where('is_read', false)
                    ->count();

                try {
                    broadcast(new ThreadNotification(
                        $thread->user_id,
                        'thread_like',
                        $thread->id,
                        null,
                        Str::limit($thread->content, 80),
                        $currentUser,
                        $unreadLikesCount
                    ));
                } catch (\Throwable $e) {}
            }
        }

        // Sinkronkan likes_count secara akurat langsung dari jumlah record riil di blip_thread_likes
        $actualLikesCount = BlipThreadLike::where('thread_id', $thread->id)->count();
        $thread->likes_count = $actualLikesCount;
        $thread->save();

        return response()->json([
            'status' => 'success',
            'is_liked' => $isLiked,
            'likes_count' => $actualLikesCount,
        ]);
    }

    /**
     * Dapatkan daftar pengguna yang menyukai (like) suatu thread
     */
    public function getThreadLikes(Request $request, $id)
    {
        $currentUser = $this->resolveUser($request);
        $thread = BlipThread::findOrFail($id);

        $userLat = $request->latitude !== null ? floatval($request->latitude) : $currentUser->latitude;
        $userLon = $request->longitude !== null ? floatval($request->longitude) : $currentUser->longitude;

        $likes = BlipThreadLike::with([
            'user:id,name,username,avatar_color,avatar_url,gender,birthdate,age,latitude,longitude'
        ])
        ->where('thread_id', $id)
        ->latest('id')
        ->get();

        $userIds = $likes->pluck('user_id')->filter(fn($uid) => $uid !== $currentUser->id)->toArray();

        // Ambil status pertemanan dengan user yang menyukai
        $friendships = BlipFriendship::where(function ($q) use ($currentUser, $userIds) {
            $q->where('user_id', $currentUser->id)->whereIn('friend_id', $userIds);
        })->orWhere(function ($q) use ($currentUser, $userIds) {
            $q->whereIn('user_id', $userIds)->where('friend_id', $currentUser->id);
        })->get();

        $friendshipMap = [];
        foreach ($friendships as $f) {
            $otherId = ($f->user_id === $currentUser->id) ? $f->friend_id : $f->user_id;
            $friendshipMap[$otherId] = [
                'status' => $f->status,
                'initiator' => $f->user_id,
                'id' => $f->id,
            ];
        }

        $users = $likes->map(function ($like) use ($userLat, $userLon, $currentUser, $friendshipMap) {
            $u = $like->user;
            if (!$u) return null;

            $dist = $this->calculateDistance($userLat, $userLon, $u->latitude, $u->longitude);
            $fInfo = $friendshipMap[$u->id] ?? null;

            return [
                'id' => $u->id,
                'name' => $u->name,
                'username' => $u->username,
                'avatar_color' => $u->avatar_color,
                'avatar_url' => $u->avatar_url,
                'gender' => $u->gender,
                'age' => $u->calculated_age,
                'is_me' => ($u->id === $currentUser->id),
                'distance_formatted' => $this->formatDistanceText($dist),
                'liked_at_human' => $like->created_at ? $like->created_at->diffForHumans() : 'Baru saja',
                'friendship_status' => $fInfo ? $fInfo['status'] : 'none',
                'friendship_initiator' => $fInfo ? $fInfo['initiator'] : null,
                'friendship_id' => $fInfo ? $fInfo['id'] : null,
            ];
        })->filter()->values();

        return response()->json([
            'status' => 'success',
            'likes_count' => $thread->likes_count,
            'users' => $users,
        ]);
    }

    /**
     * Hapus postingan thread milik sendiri
     */
    public function deleteThread(Request $request, $id)
    {
        $currentUser = $this->resolveUser($request);
        $thread = BlipThread::findOrFail($id);

        if ($thread->user_id !== $currentUser->id) {
            return response()->json([
                'status' => 'error',
                'message' => 'Anda tidak memiliki hak untuk menghapus postingan ini.',
            ], 403);
        }

        $thread->delete();

        // Bersihkan cache feed publik knot terkait
        $this->clearKnotFeedCache($thread->latitude, $thread->longitude);

        return response()->json([
            'status' => 'success',
            'message' => 'Postingan berhasil dihapus.',
        ]);
    }

    /**
     * Hapus balasan milik sendiri
     */
    public function deleteReply(Request $request, $replyId)
    {
        $currentUser = $this->resolveUser($request);
        $reply = BlipThreadReply::with('thread')->findOrFail($replyId);

        if ($reply->user_id !== $currentUser->id && $reply->thread->user_id !== $currentUser->id) {
            return response()->json([
                'status' => 'error',
                'message' => 'Anda tidak memiliki izin menghapus balasan ini.',
            ], 403);
        }

        $thread = $reply->thread;
        $reply->delete();

        if ($thread && $thread->replies_count > 0) {
            $thread->decrement('replies_count');
            $this->clearKnotFeedCache($thread->latitude, $thread->longitude);
        }

        return response()->json([
            'status' => 'success',
            'message' => 'Balasan berhasil dihapus.',
            'replies_count' => $thread ? $thread->fresh()->replies_count : 0,
        ]);
    }

    /**
     * Cari profil user berdasarkan username untuk info panel / mention click
     */
    public function getUserProfileByUsername(Request $request, $username)
    {
        $currentUser = $this->resolveUser($request);
        $cleanUsername = strtolower(ltrim(trim($username), '@'));

        $user = BlipUser::where('username', $cleanUsername)->first();
        if (!$user) {
            return response()->json([
                'status' => 'error',
                'message' => 'Pengguna tidak ditemukan.',
            ], 404);
        }

        return $this->buildUserProfileResponse($request, $currentUser, $user);
    }

    /**
     * Dapatkan detail profil user berdasarkan ID pengguna
     */
    public function getUserProfileById(Request $request, $id)
    {
        $currentUser = $this->resolveUser($request);
        $user = BlipUser::find($id);
        if (!$user) {
            return response()->json([
                'status' => 'error',
                'message' => 'Pengguna tidak ditemukan.',
            ], 404);
        }

        return $this->buildUserProfileResponse($request, $currentUser, $user);
    }

    /**
     * Helper untuk menghasilkan format JSON profil pengguna beserta jarak & relasi pertemanan
     */
    private function buildUserProfileResponse(Request $request, BlipUser $currentUser, BlipUser $user)
    {
        $userLat = $request->latitude !== null ? floatval($request->latitude) : $currentUser->latitude;
        $userLon = $request->longitude !== null ? floatval($request->longitude) : $currentUser->longitude;
        $dist = $this->calculateDistance($userLat, $userLon, $user->latitude, $user->longitude);

        // Status pertemanan
        $isFriend = false;
        $friendshipStatus = null;
        $friendshipInitiator = null;
        $friendshipId = null;

        if ($user->id !== $currentUser->id) {
            $friendship = BlipFriendship::where(function ($q) use ($currentUser, $user) {
                $q->where('user_id', $currentUser->id)->where('friend_id', $user->id);
            })->orWhere(function ($q) use ($currentUser, $user) {
                $q->where('user_id', $user->id)->where('friend_id', $currentUser->id);
            })->first();

            if ($friendship) {
                $friendshipId = $friendship->id;
                $friendshipStatus = $friendship->status;
                $friendshipInitiator = $friendship->user_id;
                $isFriend = ($friendship->status === 'accepted');
            }
        }

        return response()->json([
            'status' => 'success',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'username' => $user->username,
                'avatar_color' => $user->avatar_color,
                'avatar_url' => $user->avatar_url,
                'gender' => $user->gender,
                'age' => $user->calculated_age,
                'bio' => $user->bio,
                'distance_formatted' => $this->formatDistanceText($dist),
                'joined_human' => $user->created_at ? $user->created_at->translatedFormat('F Y') : 'Baru saja',
                'joined_date' => $user->created_at ? $user->created_at->format('M Y') : '',
                'threads_count' => BlipThread::where('user_id', $user->id)->count(),
                'is_friend' => $isFriend,
                'is_me' => ($user->id === $currentUser->id),
                'friendship_status' => $friendshipStatus,
                'friendship_initiator' => $friendshipInitiator,
                'friendship_id' => $friendshipId,
            ],
        ]);
    }

    /**
     * Cari pengguna untuk di-add friend (digunakan di tab Knot / Radar, dengan Pagination / Lazy Load)
     */
    public function searchUsersForFriend(Request $request)
    {
        $currentUser = $this->resolveUser($request);
        $rawQ = trim($request->query('q', ''));
        $q = strtolower(ltrim($rawQ, '@'));
        $page = max(1, (int) $request->query('page', 1));
        $limit = min(30, max(5, (int) $request->query('limit', 10)));

        if (strlen($q) < 1) {
            return response()->json([
                'status' => 'success',
                'users' => [],
                'page' => $page,
                'has_more' => false,
            ]);
        }

        $query = BlipUser::where('id', '!=', $currentUser->id)
            ->where(function ($sub) use ($q) {
                $sub->where('username', 'like', "%{$q}%")
                    ->orWhere('name', 'like', "%{$q}%");
            });

        $total = $query->count();
        $users = $query->orderBy('name', 'asc')
            ->skip(($page - 1) * $limit)
            ->take($limit)
            ->get();

        $hasMore = ($page * $limit) < $total;

        $userLat = $request->latitude !== null ? floatval($request->latitude) : $currentUser->latitude;
        $userLon = $request->longitude !== null ? floatval($request->longitude) : $currentUser->longitude;

        // Ambil ID user-user ini untuk batch load status pertemanan
        $userIds = $users->pluck('id')->toArray();
        $friendships = BlipFriendship::where(function ($sub) use ($currentUser, $userIds) {
            $sub->where('user_id', $currentUser->id)->whereIn('friend_id', $userIds);
        })->orWhere(function ($sub) use ($currentUser, $userIds) {
            $sub->where('friend_id', $currentUser->id)->whereIn('user_id', $userIds);
        })->get();

        $friendshipMap = [];
        foreach ($friendships as $f) {
            $otherId = ($f->user_id == $currentUser->id) ? $f->friend_id : $f->user_id;
            $friendshipMap[$otherId] = $f;
        }

        $results = $users->map(function ($u) use ($userLat, $userLon, $friendshipMap) {
            $dist = $this->calculateDistance($userLat, $userLon, $u->latitude, $u->longitude);
            $f = $friendshipMap[$u->id] ?? null;

            $friendshipStatus = 'none';
            $friendshipInitiator = null;
            $friendshipId = null;

            if ($f) {
                $friendshipStatus = $f->status; // pending, accepted
                $friendshipInitiator = $f->user_id;
                $friendshipId = $f->id;
            }

            return [
                'id' => $u->id,
                'name' => $u->name,
                'username' => $u->username,
                'avatar_color' => $u->avatar_color,
                'avatar_url' => $u->avatar_url,
                'gender' => $u->gender,
                'age' => $u->calculated_age,
                'bio' => $u->bio,
                'distance_formatted' => $this->formatDistanceText($dist),
                'distance_km' => $dist,
                'is_friend' => ($friendshipStatus === 'accepted'),
                'friendship_status' => $friendshipStatus,
                'friendship_initiator' => $friendshipInitiator,
                'friendship_id' => $friendshipId,
            ];
        });

        return response()->json([
            'status' => 'success',
            'users' => $results,
            'page' => $page,
            'has_more' => $hasMore,
            'total' => $total,
        ]);
    }

    /**
     * Dapatkan saran mention (@username) saat mengetik
     */
    public function getMentionSuggestions(Request $request)
    {
        $currentUser = $this->resolveUser($request);
        $q = strtolower(ltrim(trim($request->query('q', '')), '@'));

        $query = BlipUser::whereNotNull('username')
            ->where('id', '!=', $currentUser->id);

        if (!empty($q)) {
            $query->where(function ($sub) use ($q) {
                $sub->where('username', 'like', "%{$q}%")
                    ->orWhere('name', 'like', "%{$q}%");
            });
        }

        $users = $query->orderBy('name', 'asc')
            ->take(8)
            ->get();

        $userLat = $request->latitude !== null ? floatval($request->latitude) : $currentUser->latitude;
        $userLon = $request->longitude !== null ? floatval($request->longitude) : $currentUser->longitude;

        $results = $users->map(function ($u) use ($userLat, $userLon) {
            $dist = $this->calculateDistance($userLat, $userLon, $u->latitude, $u->longitude);
            return [
                'id' => $u->id,
                'name' => $u->name,
                'username' => $u->username,
                'avatar_color' => $u->avatar_color,
                'avatar_url' => $u->avatar_url,
                'gender' => $u->gender,
                'age' => $u->calculated_age,
                'distance_formatted' => $this->formatDistanceText($dist),
            ];
        });

        return response()->json([
            'status' => 'success',
            'users' => $results,
        ]);
    }

    /**
     * Helper untuk memproses mention @username di teks dan mengirim notifikasi
     */
    private function notifyMentionedUsers(string $content, BlipUser $sender, int $threadId, ?int $replyId = null, array $excludeUserIds = [])
    {
        // Cari semua pola @username
        preg_match_all('/@([a-zA-Z0-9_]{3,30})/', $content, $matches);
        if (empty($matches[1])) {
            return;
        }

        $usernames = array_unique(array_map('strtolower', $matches[1]));
        $excludeIds = array_merge([$sender->id], $excludeUserIds);

        $mentionedUsers = BlipUser::whereIn('username', $usernames)
            ->whereNotIn('id', $excludeIds)
            ->get();

        foreach ($mentionedUsers as $target) {
            BlipNotification::createWithCap([
                'user_id' => $target->id,
                'sender_id' => $sender->id,
                'type' => 'thread_mention',
                'thread_id' => $threadId,
                'reply_id' => $replyId,
                'preview_text' => Str::limit($content, 80),
                'is_read' => false,
            ]);

            try {
                broadcast(new ThreadNotification(
                    $target->id,
                    'thread_mention',
                    $threadId,
                    $replyId,
                    Str::limit($content, 80),
                    $sender
                ));
            } catch (\Throwable $e) {}
        }
    }

    /**
     * Dapatkan daftar notifikasi thread untuk pengguna saat ini
     * (Notifikasi like yang belum dibaca dikelompokkan per postingan thread)
     */
    public function getThreadNotifications(Request $request)
    {
        $currentUser = $this->resolveUser($request);

        $notifications = BlipNotification::with(['sender', 'thread'])
            ->where('user_id', $currentUser->id)
            ->latest()
            ->take(60)
            ->get();

        $unreadCount = BlipNotification::where('user_id', $currentUser->id)
            ->where('is_read', false)
            ->count();

        // Kelompokkan notifikasi like yang belum dibaca per thread_id
        $groupedData = [];
        $unreadLikesGrouped = []; // key: thread_id => array of notification IDs & senders

        foreach ($notifications as $n) {
            if ($n->type === 'thread_like' && !$n->is_read) {
                $tId = $n->thread_id;
                if (!isset($unreadLikesGrouped[$tId])) {
                    $unreadLikesGrouped[$tId] = [
                        'first_notif' => $n,
                        'notif_ids' => [$n->id],
                        'senders' => [$n->sender],
                        'count' => 1,
                    ];
                } else {
                    $unreadLikesGrouped[$tId]['notif_ids'][] = $n->id;
                    $unreadLikesGrouped[$tId]['senders'][] = $n->sender;
                    $unreadLikesGrouped[$tId]['count']++;
                }
            } else {
                // Notifikasi reply, mention, atau like yang SUDAH dibaca ditampilkan normal
                $groupedData[] = [
                    'id' => $n->id,
                    'ids' => [$n->id],
                    'type' => $n->type,
                    'thread_id' => $n->thread_id,
                    'reply_id' => $n->reply_id,
                    'preview_text' => $n->preview_text,
                    'is_read' => $n->is_read,
                    'like_count' => 1,
                    'created_at_human' => $n->created_at ? $n->created_at->diffForHumans() : 'Baru saja',
                    'sender' => [
                        'id' => $n->sender?->id,
                        'name' => $n->sender?->name ?? 'Pengguna',
                        'username' => $n->sender?->username,
                        'avatar_color' => $n->sender?->avatar_color ?? '#4f46e5',
                        'avatar_url' => $n->sender?->avatar_url,
                    ],
                ];
            }
        }

        // Masukkan kelompok like yang belum dibaca ke dalam daftar notifikasi teratas
        foreach ($unreadLikesGrouped as $tId => $group) {
            $first = $group['first_notif'];
            $count = $group['count'];
            $latestSender = $first->sender;

            $groupedData[] = [
                'id' => $first->id,
                'ids' => $group['notif_ids'],
                'type' => 'thread_like',
                'thread_id' => $tId,
                'reply_id' => null,
                'preview_text' => $first->preview_text,
                'is_read' => false,
                'like_count' => $count,
                'created_at_human' => $first->created_at ? $first->created_at->diffForHumans() : 'Baru saja',
                'sender' => [
                    'id' => $latestSender?->id,
                    'name' => $latestSender?->name ?? 'Pengguna',
                    'username' => $latestSender?->username,
                    'avatar_color' => $latestSender?->avatar_color ?? '#4f46e5',
                    'avatar_url' => $latestSender?->avatar_url,
                ],
            ];
        }

        // Urutkan kembali berdasarkan notifikasi ID terbesar (terbaru)
        usort($groupedData, fn($a, $b) => $b['id'] <=> $a['id']);

        return response()->json([
            'status' => 'success',
            'unread_count' => $unreadCount,
            'notifications' => array_slice($groupedData, 0, 30),
        ]);
    }

    /**
     * Tandai notifikasi thread sebagai sudah dibaca
     */
    public function markThreadNotificationsAsRead(Request $request)
    {
        $currentUser = $this->resolveUser($request);
        $notificationId = $request->input('notification_id');
        $notificationIds = $request->input('notification_ids');

        if (!empty($notificationIds) && is_array($notificationIds)) {
            BlipNotification::where('user_id', $currentUser->id)
                ->whereIn('id', $notificationIds)
                ->update(['is_read' => true]);
        } elseif ($notificationId) {
            BlipNotification::where('user_id', $currentUser->id)
                ->where('id', $notificationId)
                ->update(['is_read' => true]);
        } else {
            // Tandai semua sebagai dibaca
            BlipNotification::where('user_id', $currentUser->id)
                ->where('is_read', false)
                ->update(['is_read' => true]);
        }

        $remainingUnread = BlipNotification::where('user_id', $currentUser->id)
            ->where('is_read', false)
            ->count();

        return response()->json([
            'status' => 'success',
            'unread_count' => $remainingUnread,
        ]);
    }
}
