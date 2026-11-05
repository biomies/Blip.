<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\BlipNotification;
use Carbon\Carbon;

class PruneOldBlipNotifications extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'blip:prune-notifications';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Bersihkan notifikasi kedaluwarsa (>30 hari sudah dibaca / >90 hari belum dibaca) agar database tetap ramping';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $cutoffRead = Carbon::now()->subDays(30);
        $cutoffUnread = Carbon::now()->subDays(90);

        // 1. Hapus notifikasi yang sudah dibaca dan berusia lebih dari 30 hari
        $deletedRead = BlipNotification::where('is_read', true)
            ->where('created_at', '<', $cutoffRead)
            ->delete();

        // 2. Hapus notifikasi usang yang belum dibaca tetapi sudah lebih dari 90 hari
        $deletedUnread = BlipNotification::where('is_read', false)
            ->where('created_at', '<', $cutoffUnread)
            ->delete();

        $total = $deletedRead + $deletedUnread;
        $this->info("Berhasil membersihkan {$total} notifikasi usang ({$deletedRead} sudah dibaca, {$deletedUnread} belum dibaca).");

        return Command::SUCCESS;
    }
}

