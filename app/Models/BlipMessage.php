<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BlipMessage extends Model
{
    protected $table = 'blip_messages';

    protected $fillable = [
        'sender_id',
        'receiver_id',
        'type',
        'message',
        'photo_path',
        'photo_size',
        'is_saved',
        'expires_at',
        'is_read',
        'deleted_by_sender',
        'deleted_by_receiver',
    ];

    protected $casts = [
        'is_read' => 'boolean',
        'is_saved' => 'boolean',
        'deleted_by_sender' => 'boolean',
        'deleted_by_receiver' => 'boolean',
        'expires_at' => 'datetime',
    ];

    public function sender()
    {
        return $this->belongsTo(BlipUser::class, 'sender_id');
    }

    public function receiver()
    {
        return $this->belongsTo(BlipUser::class, 'receiver_id');
    }
}
