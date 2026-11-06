<?php

namespace App\Events;

use App\Models\BlipUser;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class ThreadNotification implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $targetUserId;
    public $type; // 'thread_reply' | 'thread_mention'
    public $threadId;
    public $replyId;
    public $previewText;
    public $sender;
    public $createdAtHuman;
    public $groupedCount; // Jumlah orang yang melakukan aksi (misal like) jika belum dibaca
    public $unreadCount; // Total notifikasi unread riil di database untuk targetUser

    public function __construct(int $targetUserId, string $type, int $threadId, ?int $replyId, ?string $previewText, BlipUser $sender, int $groupedCount = 1, ?int $unreadCount = null)
    {
        $this->targetUserId = $targetUserId;
        $this->type = $type;
        $this->threadId = $threadId;
        $this->replyId = $replyId;
        $this->previewText = $previewText;
        $this->groupedCount = $groupedCount;
        $this->unreadCount = $unreadCount;
        $this->sender = [
            'id' => $sender->id,
            'name' => $sender->name,
            'username' => $sender->username,
            'avatar_color' => $sender->avatar_color,
            'avatar_url' => $sender->avatar_url,
        ];
        $this->createdAtHuman = 'Baru saja';
    }

    public function broadcastOn(): array
    {
        return [
            new Channel('user.' . $this->targetUserId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'thread.notification';
    }
}

