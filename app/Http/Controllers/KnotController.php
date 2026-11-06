<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\BlipUser;
use App\Models\BlipThread;
use App\Models\BlipThreadReply;
use App\Models\BlipThreadLike;
use App\Models\BlipNotification;
use App\Models\BlipFriendship;
use App\Events\ThreadNotification;
use Illuminate\Support\Str;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;

class KnotController extends BaseBlipController
{
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
     * Dapatkan daftar thread/knot khusus milik satu user (untuk profil pengguna)
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
     * Buat thread/knot baru (dengan Anti-Spam Idempotency Token)
     */
    public function createThread(Request $request)
    {
        $currentUser = $this->resolveUser($request);

        $request->validate([
            'content' => 'required|string|max:1000',
            'latitude' => 'nullable|numeric',
            'longitude' => 'nullable|numeric',
        ]);

        $content = trim($request->content);
        $contentHash = md5($currentUser->id . '_' . $content);
        $idempotencyKey = "idempotency_knot_post_{$contentHash}";

        // Cegah spam/double-click postingan identik dalam kurun 5 detik
        if (!Cache::add($idempotencyKey, true, 5)) {
            return response()->json([
                'status' => 'error',
                'message' => 'Anda baru saja mengirim postingan yang sama. Harap tunggu beberapa detik.',
            ], 429);
        }

        $lat = $request->latitude !== null ? floatval($request->latitude) : $currentUser->latitude;
        $lon = $request->longitude !== null ? floatval($request->longitude) : $currentUser->longitude;

        if ($lat !== null && $lon !== null) {
            $currentUser->update([
                'latitude' => $lat,
                'longitude' => $lon,
            ]);
        }

        $thread = BlipThread::create([
            'user_id' => $currentUser->id,
            'content' => $content,
            'latitude' => $lat,
            'longitude' => $lon,
            'likes_count' => 0,
            'replies_count' => 0,
        ]);

        // Bersihkan cache feed publik knot terkait
        $this->clearKnotFeedCache($lat, $lon);

        // Deteksi dan kirim notifikasi jika ada mention @username
        $this->notifyMentionedUsers($thread->content, $currentUser, $thread->id, null);

        $dist = $this->calculateDistance($lat, $lon, $thread->latitude, $thread->longitude);

        return response()->json([
            'status' => 'success',
            'message' => 'Postingan knot berhasil dipublikasikan!',
            'thread' => [
                'id' => $thread->id,
                'user_id' => $thread->user_id,
                'content' => $thread->content,
                'likes_count' => 0,
                'replies_count' => 0,
                'is_liked' => false,
                'is_mine' => true,
                'distance_km' => $dist,
                'distance_formatted' => $this->formatDistanceText($dist),
                'created_at_human' => 'Baru saja',
                'created_at_time' => Carbon::now()->format('H:i'),
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
     * Dapatkan detail thread beserta balasan dan status like
     */
    public function getThreadDetail(Request $request, $id)
    {
        $currentUser = $this->resolveUser($request);
        $userLat = $request->latitude !== null ? floatval($request->latitude) : $currentUser->latitude;
        $userLon = $request->longitude !== null ? floatval($request->longitude) : $currentUser->longitude;

        $thread = BlipThread::with(['user', 'replies.user'])->findOrFail($id);

        $isLiked = BlipThreadLike::where('thread_id', $thread->id)
            ->where('user_id', $currentUser->id)
            ->exists();

        $dist = $this->calculateDistance($userLat, $userLon, $thread->latitude, $thread->longitude);

        $repliesData = $thread->replies->map(function ($r) use ($userLat, $userLon, $currentUser) {
            $replyDist = $this->calculateDistance($userLat, $userLon, $r->latitude, $r->longitude);

            return [
                'id' => $r->id,
                'user_id' => $r->user_id,
                'content' => $r->content,
                'distance_km' => $replyDist,
                'distance_formatted' => $this->formatDistanceText($replyDist),
                'created_at_human' => $r->created_at ? $r->created_at->diffForHumans() : 'Baru saja',
                'created_at_time' => $r->created_at ? $r->created_at->format('H:i') : '',
                'is_mine' => $r->user_id === $currentUser->id,
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
                'user_id' => $thread->user_id,
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
                'replies' => $repliesData,
            ],
            'replies' => $repliesData,
        ]);
    }

    /**
     * Balas sebuah thread
     */
    public function replyThread(Request $request, $id)
    {
        $currentUser = $this->resolveUser($request);

        $request->validate([
            'content' => 'required|string|max:1000',
            'latitude' => 'nullable|numeric',
            'longitude' => 'nullable|numeric',
        ]);

        $content = trim($request->content);
        $contentHash = md5($currentUser->id . '_' . $id . '_' . $content);
        $idempotencyKey = "idempotency_knot_reply_{$contentHash}";

        // Cegah spam/double-click balasan identik dalam kurun 5 detik
        if (!Cache::add($idempotencyKey, true, 5)) {
            return response()->json([
                'status' => 'error',
                'message' => 'Anda baru saja mengirim balasan yang sama. Harap tunggu sebentar.',
            ], 429);
        }

        $thread = BlipThread::with('user')->findOrFail($id);

        $lat = $request->latitude !== null ? floatval($request->latitude) : $currentUser->latitude;
        $lon = $request->longitude !== null ? floatval($request->longitude) : $currentUser->longitude;

        if ($lat !== null && $lon !== null) {
            $currentUser->update([
                'latitude' => $lat,
                'longitude' => $lon,
            ]);
        }

        $reply = BlipThreadReply::create([
            'thread_id' => $thread->id,
            'user_id' => $currentUser->id,
            'content' => $content,
            'latitude' => $lat,
            'longitude' => $lon,
        ]);

        $actualRepliesCount = BlipThreadReply::where('thread_id', $thread->id)->count();
        $thread->replies_count = $actualRepliesCount;
        $thread->save();

        // Bersihkan cache feed publik knot
        $this->clearKnotFeedCache($thread->latitude, $thread->longitude);

        // Notifikasi ke pemilik thread jika yang membalas bukan dirinya sendiri
        if ($thread->user_id !== $currentUser->id) {
            BlipNotification::createWithCap([
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

        // Deteksi dan kirim notifikasi mention @username di dalam balasan
        $this->notifyMentionedUsers($reply->content, $currentUser, $thread->id, $reply->id, [$thread->user_id]);

        $replyDist = $this->calculateDistance($lat, $lon, $reply->latitude, $reply->longitude);

        return response()->json([
            'status' => 'success',
            'message' => 'Balasan berhasil dikirim!',
            'reply' => [
                'id' => $reply->id,
                'user_id' => $reply->user_id,
                'content' => $reply->content,
                'distance_km' => $replyDist,
                'distance_formatted' => $this->formatDistanceText($replyDist),
                'created_at_human' => 'Baru saja',
                'created_at_time' => Carbon::now()->format('H:i'),
                'is_mine' => true,
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
            'replies_count' => $thread->fresh()->replies_count,
        ]);
    }

    /**
     * Suka / Batal Suka sebuah thread (Toggle Like)
     */
    public function toggleLikeThread(Request $request, $id)
    {
        $currentUser = $this->resolveUser($request);
        $thread = BlipThread::findOrFail($id);

        $existing = BlipThreadLike::where('thread_id', $thread->id)
            ->where('user_id', $currentUser->id)
            ->first();

        if ($existing) {
            $existing->delete();
            $isLiked = false;

            // Jika dibatalkan (unlike), hapus notifikasi like yang belum dibaca dari user ini
            BlipNotification::where('user_id', $thread->user_id)
                ->where('sender_id', $currentUser->id)
                ->where('thread_id', $thread->id)
                ->where('type', 'thread_like')
                ->where('is_read', false)
                ->delete();

            // Broadcast event un-like agar UI penerima langsung ter-update live tanpa reload
            if ($thread->user_id !== $currentUser->id) {
                try {
                    broadcast(new ThreadNotification(
                        $thread->user_id,
                        'thread_unlike',
                        $thread->id,
                        null,
                        Str::limit($thread->content, 80),
                        $currentUser
                    ));
                } catch (\Throwable $e) {}
            }
        } else {
            BlipThreadLike::firstOrCreate([
                'thread_id' => $thread->id,
                'user_id' => $currentUser->id,
            ]);
            $isLiked = true;

            // Buat notifikasi jika yang menyukai bukan pembuat postingan
            if ($thread->user_id !== $currentUser->id) {
                // Pastikan tidak ada duplikasi notifikasi like yang belum dibaca dari user yang sama
                $alreadyNotified = BlipNotification::where('user_id', $thread->user_id)
                    ->where('sender_id', $currentUser->id)
                    ->where('thread_id', $thread->id)
                    ->where('type', 'thread_like')
                    ->where('is_read', false)
                    ->exists();

                if (!$alreadyNotified) {
                    BlipNotification::createWithCap([
                        'user_id' => $thread->user_id,
                        'sender_id' => $currentUser->id,
                        'type' => 'thread_like',
                        'thread_id' => $thread->id,
                        'reply_id' => null,
                        'preview_text' => Str::limit($thread->content, 80),
                        'is_read' => false,
                    ]);

                    try {
                        broadcast(new ThreadNotification(
                            $thread->user_id,
                            'thread_like',
                            $thread->id,
                            null,
                            Str::limit($thread->content, 80),
                            $currentUser
                        ));
                    } catch (\Throwable $e) {}
                }
            }
        }

        // Sinkronkan likes_count secara akurat langsung dari jumlah record riil di blip_thread_likes
        $actualLikesCount = BlipThreadLike::where('thread_id', $thread->id)->count();
        $thread->likes_count = $actualLikesCount;
        $thread->save();

        // Bersihkan cache feed publik knot
        $this->clearKnotFeedCache($thread->latitude, $thread->longitude);

        return response()->json([
            'status' => 'success',
            'is_liked' => $isLiked,
            'likes_count' => $actualLikesCount,
        ]);
    }

    /**
     * Dapatkan daftar pengguna yang menyukai thread tertentu
     */
    public function getThreadLikes(Request $request, $id)
    {
        $currentUser = $this->resolveUser($request);
        $userLat = $request->latitude !== null ? floatval($request->latitude) : $currentUser->latitude;
        $userLon = $request->longitude !== null ? floatval($request->longitude) : $currentUser->longitude;

        $thread = BlipThread::findOrFail($id);

        $likes = BlipThreadLike::with('user')
            ->where('thread_id', $thread->id)
            ->latest('id')
            ->take(50)
            ->get();

        $userIds = $likes->pluck('user_id')->filter()->toArray();
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

        $users = $likes->map(function ($like) use ($userLat, $userLon, $currentUser, $friendshipMap) {
            $u = $like->user;
            if (!$u) return null;

            $dist = $this->calculateDistance($userLat, $userLon, $u->latitude, $u->longitude);
            $f = $friendshipMap[$u->id] ?? null;

            $friendshipStatus = 'none';
            $friendshipInitiator = null;
            $friendshipId = null;

            if ($f) {
                $friendshipStatus = $f->status;
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
                'distance_formatted' => $this->formatDistanceText($dist),
                'is_me' => ($u->id === $currentUser->id),
                'is_friend' => ($friendshipStatus === 'accepted'),
                'friendship_status' => $friendshipStatus,
                'friendship_initiator' => $friendshipInitiator,
                'friendship_id' => $friendshipId,
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

        $actualRepliesCount = 0;
        if ($thread) {
            $actualRepliesCount = BlipThreadReply::where('thread_id', $thread->id)->count();
            $thread->replies_count = $actualRepliesCount;
            $thread->save();
            $this->clearKnotFeedCache($thread->latitude, $thread->longitude);
        }

        return response()->json([
            'status' => 'success',
            'message' => 'Balasan berhasil dihapus.',
            'replies_count' => $actualRepliesCount,
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

        $groupedData = [];
        $unreadLikesGrouped = [];

        foreach ($notifications as $n) {
            if ($n->type === 'thread_like' && !$n->is_read) {
                $tId = $n->thread_id;
                if (!isset($unreadLikesGrouped[$tId])) {
                    $unreadLikesGrouped[$tId] = [
                        'first_notif' => $n,
                        'notif_ids' => [$n->id],
                        'senders_map' => [$n->sender_id => $n->sender],
                    ];
                } else {
                    $unreadLikesGrouped[$tId]['notif_ids'][] = $n->id;
                    $unreadLikesGrouped[$tId]['senders_map'][$n->sender_id] = $n->sender;
                }
            } else {
                $groupedData[] = [
                    'id' => $n->id,
                    'ids' => [$n->id],
                    'type' => $n->type,
                    'thread_id' => $n->thread_id,
                    'reply_id' => $n->reply_id,
                    'preview_text' => $n->preview_text,
                    'is_read' => $n->is_read,
                    'like_count' => 1,
                    'other_senders' => [],
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

        foreach ($unreadLikesGrouped as $tId => $group) {
            $first = $group['first_notif'];
            $uniqueSenders = array_values($group['senders_map']);
            $count = count($uniqueSenders);
            $latestSender = $uniqueSenders[0] ?? $first->sender;
            $secondSender = $uniqueSenders[1] ?? null;

            $groupedData[] = [
                'id' => $first->id,
                'ids' => $group['notif_ids'],
                'type' => 'thread_like',
                'thread_id' => $tId,
                'reply_id' => null,
                'preview_text' => $first->preview_text,
                'is_read' => false,
                'like_count' => $count,
                'second_sender' => $secondSender ? [
                    'id' => $secondSender->id,
                    'name' => $secondSender->name,
                    'username' => $secondSender->username,
                    'avatar_color' => $secondSender->avatar_color ?? '#06b6d4',
                    'avatar_url' => $secondSender->avatar_url,
                ] : null,
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
        foreach ([10, 15, 20, 30, 50] as $lim) {
            Cache::forget("blip_knot_feed_0_0_{$lim}");
        }
    }
}

