<?php

namespace App\Events;

use App\Models\BlipUser;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class FriendNotification implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $targetUserId;
    public $type;
    public $sender;

    public function __construct(int $targetUserId, string $type, BlipUser $sender)
    {
        $this->targetUserId = $targetUserId;
        $this->type = $type; // 'request_received', 'request_accepted'
        $this->sender = [
            'id' => $sender->id,
            'name' => $sender->name,
            'avatar_color' => $sender->avatar_color,
        ];
    }

    public function broadcastOn(): array
    {
        return [
            new Channel('user.' . $this->targetUserId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'friend.notification';
    }
}
