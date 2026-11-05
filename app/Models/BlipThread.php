<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BlipThread extends Model
{
    protected $table = 'blip_threads';

    protected $fillable = [
        'user_id',
        'content',
        'latitude',
        'longitude',
        'likes_count',
        'replies_count',
    ];

    protected $casts = [
        'latitude' => 'float',
        'longitude' => 'float',
        'likes_count' => 'integer',
        'replies_count' => 'integer',
    ];

    public function user()
    {
        return $this->belongsTo(BlipUser::class, 'user_id');
    }

    public function replies()
    {
        return $this->hasMany(BlipThreadReply::class, 'thread_id')->latest();
    }

    public function likes()
    {
        return $this->hasMany(BlipThreadLike::class, 'thread_id');
    }
}

