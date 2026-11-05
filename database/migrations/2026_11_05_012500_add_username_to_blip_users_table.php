<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('blip_users', function (Blueprint $table) {
            $table->string('username', 30)->nullable()->unique()->after('name');
        });

        // Generate username unik untuk user yang sudah ada
        $existingUsers = DB::table('blip_users')->whereNull('username')->get();
        foreach ($existingUsers as $u) {
            $cleanName = Str::slug($u->name, '_');
            $cleanName = preg_replace('/[^a-zA-Z0-9_]/', '', $cleanName);
            if (empty($cleanName)) {
                $cleanName = 'user';
            }
            $cleanName = substr($cleanName, 0, 15);
            $candidate = Str::lower($cleanName . '_' . rand(100, 999));
            while (DB::table('blip_users')->where('username', $candidate)->exists()) {
                $candidate = Str::lower($cleanName . '_' . rand(1000, 9999));
            }

            DB::table('blip_users')->where('id', $u->id)->update([
                'username' => $candidate,
            ]);
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('blip_users', function (Blueprint $table) {
            $table->dropColumn('username');
        });
    }
};

