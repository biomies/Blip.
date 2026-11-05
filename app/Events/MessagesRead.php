<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class MessagesRead implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $readerId;
    public $senderId;

    public function __construct(int $readerId, int $senderId)
    {
        $this->readerId = $readerId;
        $this->senderId = $senderId;
    }

    public function broadcastOn(): array
    {
        // Broadcast ke channel user pengirim pesan agar status centangnya terupdate ke centang dua biru
        return [
            new Channel('user.' . $this->senderId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'messages.read';
    }
}
