<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class WebRtcSignal implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $fromUserId;
    public $toUserId;
    public $type;
    public $data;

    public function __construct(int $fromUserId, int $toUserId, string $type, $data)
    {
        $this->fromUserId = $fromUserId;
        $this->toUserId = $toUserId;
        $this->type = $type; // 'offer', 'answer', 'candidate', 'request_file', 'file_not_found'
        $this->data = $data;
    }

    public function broadcastOn(): array
    {
        return [
            new Channel('user.' . $this->toUserId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'webrtc.signal';
    }
}
