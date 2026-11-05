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
        Schema::table('blip_messages', function (Blueprint $table) {
            $table->string('type')->default('text')->after('receiver_id'); // 'text' atau 'image'
            $table->string('photo_path')->nullable()->after('message');
            $table->unsignedInteger('photo_size')->nullable()->after('photo_path');
            $table->boolean('is_saved')->default(false)->after('photo_size'); // jika true, tidak terhapus otomatis
            $table->timestamp('expires_at')->nullable()->after('is_saved'); // waktu hangus (1 jam setelah kirim)
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('blip_messages', function (Blueprint $table) {
            $table->dropColumn(['type', 'photo_path', 'photo_size', 'is_saved', 'expires_at']);
        });
    }
};
