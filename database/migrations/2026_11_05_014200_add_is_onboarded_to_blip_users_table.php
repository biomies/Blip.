<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('blip_users', function (Blueprint $table) {
            $table->boolean('is_onboarded')->default(false)->after('username');
        });

        // Set is_onboarded = true untuk akun yang sudah memiliki gender dan nama
        DB::table('blip_users')
            ->whereNotNull('gender')
            ->update(['is_onboarded' => true]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('blip_users', function (Blueprint $table) {
            $table->dropColumn('is_onboarded');
        });
    }
};

