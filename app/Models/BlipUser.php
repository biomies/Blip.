<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BlipUser extends Model
{
    protected $table = 'blip_users';

    protected $fillable = [
        'session_token',
        'name',
        'username',
        'is_onboarded',
        'gender',
        'birthdate',
        'age',
        'bio',
        'avatar_color',
        'avatar_url',
        'latitude',
        'longitude',
        'location_name',
        'last_active_at',
    ];

    protected $casts = [
        'is_onboarded' => 'boolean',
        'birthdate' => 'date',
        'age' => 'integer',
        'latitude' => 'float',
        'longitude' => 'float',
        'last_active_at' => 'datetime',
    ];

    /**
     * Hitung umur berdasarkan tanggal lahir jika ada, fallback ke kolom age
     */
    public function getCalculatedAgeAttribute(): ?int
    {
        if ($this->birthdate) {
            return $this->birthdate->age;
        }
        return $this->age;
    }

    public function sentFriendRequests()
    {
        return $this->hasMany(BlipFriendship::class, 'user_id');
    }

    public function receivedFriendRequests()
    {
        return $this->hasMany(BlipFriendship::class, 'friend_id');
    }

    public function sentMessages()
    {
        return $this->hasMany(BlipMessage::class, 'sender_id');
    }

    public function receivedMessages()
    {
        return $this->hasMany(BlipMessage::class, 'receiver_id');
    }
}
