<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BlipFriendship extends Model
{
    protected $table = 'blip_friendships';

    protected $fillable = [
        'user_id',
        'friend_id',
        'status', // pending, accepted, rejected
    ];

    public function user()
    {
        return $this->belongsTo(BlipUser::class, 'user_id');
    }

    public function friend()
    {
        return $this->belongsTo(BlipUser::class, 'friend_id');
    }
}
