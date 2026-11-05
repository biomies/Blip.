<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BlipThreadLike extends Model
{
    protected $table = 'blip_thread_likes';

    protected $fillable = [
        'thread_id',
        'user_id',
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

