<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\BlipUser;
use Carbon\Carbon;

class PruneInactiveBlipUsers extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'blip:prune-inactive';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Hapus akun otomatis yang tidak aktif/login selama 1 bulan (30 hari)';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $cutoff = Carbon::now()->subDays(30);

        $inactiveUsers = BlipUser::where(function ($q) use ($cutoff) {
            $q->where('last_active_at', '<', $cutoff)
              ->orWhere(function ($q2) use ($cutoff) {
                  $q2->whereNull('last_active_at')
                     ->where('created_at', '<', $cutoff);
              });
        })->get();

        $count = 0;
        foreach ($inactiveUsers as $user) {
            if ($user->avatar_url) {
                $filename = basename($user->avatar_url);
                $filePath = storage_path('app/public/avatars/' . $filename);
                if (file_exists($filePath)) {
                    @unlink($filePath);
                }
            }
            $user->delete();
            $count++;
        }

        $this->info("Berhasil menghapus {$count} akun dan file foto profil yang tidak aktif lebih dari 30 hari.");
    }
}
