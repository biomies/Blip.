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
        Schema::create('blip_threads', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('blip_users')->onDelete('cascade');
            $table->text('content');
            $table->decimal('latitude', 10, 8)->nullable();
            $table->decimal('longitude', 11, 8)->nullable();
            $table->unsignedInteger('likes_count')->default(0);
            $table->unsignedInteger('replies_count')->default(0);
            $table->timestamps();

            $table->index('created_at');
            $table->index(['latitude', 'longitude', 'id']);
        });

        Schema::create('blip_thread_replies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('thread_id')->constrained('blip_threads')->onDelete('cascade');
            $table->foreignId('user_id')->constrained('blip_users')->onDelete('cascade');
            $table->text('content');
            $table->decimal('latitude', 10, 8)->nullable();
            $table->decimal('longitude', 11, 8)->nullable();
            $table->timestamps();

            $table->index(['thread_id', 'created_at']);
        });

        Schema::create('blip_thread_likes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('thread_id')->constrained('blip_threads')->onDelete('cascade');
            $table->foreignId('user_id')->constrained('blip_users')->onDelete('cascade');
            $table->timestamps();

            $table->unique(['thread_id', 'user_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('blip_thread_likes');
        Schema::dropIfExists('blip_thread_replies');
        Schema::dropIfExists('blip_threads');
    }
};

