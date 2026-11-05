<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BlipThreadReply extends Model
{
    protected $table = 'blip_thread_replies';

    protected $fillable = [
        'thread_id',
        'user_id',
        'content',
        'latitude',
        'longitude',
    ];

    protected $casts = [
        'latitude' => 'float',
        'longitude' => 'float',
    ];

    public function thread()
    {
        return $this->belongsTo(BlipThread::class, 'thread_id');
    }

    public function user()
    {
        return $this->belongsTo(BlipUser::class, 'user_id');
    }
}

