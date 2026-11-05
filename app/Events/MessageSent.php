<?php

namespace App\Events;

use App\Models\BlipMessage;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class MessageSent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $message;
    public $friendId;
    public $senderId;

    public function __construct(BlipMessage $message)
    {
        $this->senderId = $message->sender_id;
        $this->friendId = $message->receiver_id;
        $isExpired = $message->expires_at && now()->greaterThan($message->expires_at) && !$message->is_saved;

        $this->message = [
            'id' => $message->id,
            'sender_id' => $message->sender_id,
            'receiver_id' => $message->receiver_id,
            'type' => $message->type ?? 'text',
            'message' => $message->message,
            'photo_url' => $message->photo_path ? asset('storage/' . $message->photo_path) : null,
            'photo_size' => $message->photo_size,
            'is_saved' => (bool) $message->is_saved,
            'is_expired' => (bool) $isExpired,
            'expires_at' => $message->expires_at ? $message->expires_at->toIso8601String() : null,
            'is_read' => (bool) $message->is_read,
            'time' => $message->created_at->format('H:i'),
            'created_at' => $message->created_at->toIso8601String(),
        ];
    }

    public function broadcastOn(): array
    {
        // Broadcast ke channel user penerima dan user pengirim
        return [
            new Channel('user.' . $this->friendId),
            new Channel('user.' . $this->senderId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'message.sent';
    }
}
