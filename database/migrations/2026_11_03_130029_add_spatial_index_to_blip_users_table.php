<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('blip_users', function (Blueprint $table) {
            $table->index(['latitude', 'longitude', 'last_active_at'], 'blip_users_spatial_active_idx');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('blip_users', function (Blueprint $table) {
            $table->dropIndex('blip_users_spatial_active_idx');
        });
    }
};
