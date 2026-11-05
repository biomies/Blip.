<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\BlipMessage;
use Illuminate\Support\Facades\Storage;
use Carbon\Carbon;

class PruneExpiredPhotos extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'blip:prune-expired-photos';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Bersihkan foto obrolan yang sudah melewati batas kedaluwarsa 1 jam dan belum disimpan';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $now = Carbon::now();

        $expiredMessages = BlipMessage::where('type', 'image')
            ->whereNotNull('photo_path')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<=', $now)
            ->get();

        $count = 0;
        foreach ($expiredMessages as $msg) {
            if ($msg->photo_path && Storage::disk('public')->exists($msg->photo_path)) {
                Storage::disk('public')->delete($msg->photo_path);
            }
            // Kosongkan photo_path dan tandai expires_at null agar tidak diproses berulang
            $msg->update([
                'photo_path' => null,
                'expires_at' => null,
            ]);
            $count++;
        }

        $this->info("Berhasil membersihkan {$count} foto yang kedaluwarsa.");
        return Command::SUCCESS;
    }
}

