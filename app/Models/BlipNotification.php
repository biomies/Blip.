<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BlipNotification extends Model
{
    protected $table = 'blip_notifications';

    protected $fillable = [
        'user_id',
        'sender_id',
        'type',
        'thread_id',
        'reply_id',
        'preview_text',
        'is_read',
    ];

    protected $casts = [
        'is_read' => 'boolean',
    ];

    public function user()
    {
        return $this->belongsTo(BlipUser::class, 'user_id');
    }

    public function sender()
    {
        return $this->belongsTo(BlipUser::class, 'sender_id');
    }

    public function thread()
    {
        return $this->belongsTo(BlipThread::class, 'thread_id');
    }

    public function reply()
    {
        return $this->belongsTo(BlipThreadReply::class, 'reply_id');
    }

    /**
     * Simpan notifikasi dengan batasan kapasitas per user (default 60 notifikasi per user)
     */
    public static function createWithCap(array $attributes, int $cap = 60): self
    {
        $notif = static::create($attributes);

        // Jika melebihi kapasitas, hapus notifikasi terlama milik user tersebut
        $userId = $attributes['user_id'] ?? null;
        if ($userId) {
            $total = static::where('user_id', $userId)->count();
            if ($total > $cap) {
                $oldIds = static::where('user_id', $userId)
                    ->oldest()
                    ->take($total - $cap)
                    ->pluck('id');
                static::whereIn('id', $oldIds)->delete();
            }
        }

        return $notif;
    }
}

