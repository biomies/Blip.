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
        Schema::create('blip_users', function (Blueprint $table) {
            $table->id();
            $table->string('session_token')->unique()->index();
            $table->string('name');
            $table->string('avatar_color')->default('#4f46e5');
            $table->decimal('latitude', 10, 7)->nullable()->index();
            $table->decimal('longitude', 10, 7)->nullable()->index();
            $table->string('location_name')->nullable();
            $table->timestamp('last_active_at')->nullable()->index();
            $table->timestamps();
        });

        Schema::create('blip_friendships', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('blip_users')->onDelete('cascade');
            $table->foreignId('friend_id')->constrained('blip_users')->onDelete('cascade');
            // status: pending, accepted, rejected
            $table->string('status')->default('pending');
            $table->timestamps();

            $table->unique(['user_id', 'friend_id']);
        });

        Schema::create('blip_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sender_id')->constrained('blip_users')->onDelete('cascade');
            $table->foreignId('receiver_id')->constrained('blip_users')->onDelete('cascade');
            $table->text('message');
            $table->boolean('is_read')->default(false);
            $table->timestamps();

            $table->index(['sender_id', 'receiver_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('blip_messages');
        Schema::dropIfExists('blip_friendships');
        Schema::dropIfExists('blip_users');
    }
};
