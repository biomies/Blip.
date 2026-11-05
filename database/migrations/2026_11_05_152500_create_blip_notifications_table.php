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
        Schema::create('blip_notifications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('blip_users')->onDelete('cascade'); // Penerima notifikasi
            $table->foreignId('sender_id')->constrained('blip_users')->onDelete('cascade'); // Pengirim pemicu notifikasi
            $table->string('type'); // 'thread_reply', 'thread_mention'
            $table->foreignId('thread_id')->constrained('blip_threads')->onDelete('cascade');
            $table->unsignedBigInteger('reply_id')->nullable();
            $table->text('preview_text')->nullable(); // Cuplikan teks balasan atau postingan
            $table->boolean('is_read')->default(false);
            $table->timestamps();

            $table->index(['user_id', 'is_read']);
            $table->index(['user_id', 'created_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('blip_notifications');
    }
};

