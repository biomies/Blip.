#!/bin/sh
set -e

# Tunggu MySQL siap
echo "Menunggu MySQL siap..."
sleep 4

# Cek dan install vendor jika belum ada
if [ ! -f /var/www/html/vendor/autoload.php ]; then
    echo "Folder vendor belum ditemukan, menginstall dependensi composer..."
    composer install --no-interaction --prefer-dist --optimize-autoloader
fi

# Jalankan migrasi database
php artisan migrate --force

# Konfigurasi Nginx
cp /var/www/html/docker/nginx/default.conf /etc/nginx/http.d/default.conf 2>/dev/null || cp /var/www/html/docker/nginx/default.conf /etc/nginx/conf.d/default.conf

# Tune PHP-FPM pool untuk 1000 user concurrency
sed -i 's/^pm.max_children = .*/pm.max_children = 30/' /etc/php85/php-fpm.d/www.conf
sed -i 's/^pm.start_servers = .*/pm.start_servers = 10/' /etc/php85/php-fpm.d/www.conf
sed -i 's/^pm.min_spare_servers = .*/pm.min_spare_servers = 5/' /etc/php85/php-fpm.d/www.conf
sed -i 's/^pm.max_spare_servers = .*/pm.max_spare_servers = 15/' /etc/php85/php-fpm.d/www.conf

# Set batas ukuran upload PHP
echo "upload_max_filesize = 30M" > /usr/local/etc/php/conf.d/uploads.ini
echo "post_max_size = 35M" >> /usr/local/etc/php/conf.d/uploads.ini
echo "memory_limit = 256M" >> /usr/local/etc/php/conf.d/uploads.ini

# Pastikan permission folder storage bisa ditulisi PHP-FPM / web
mkdir -p /var/www/html/storage/app/public/avatars /var/www/html/storage/app/public/chat_photos /var/www/html/storage/framework/sessions /var/www/html/storage/framework/views /var/www/html/storage/framework/cache
chmod -R 777 /var/www/html/storage /var/www/html/bootstrap/cache

# Start Supervisor (Nginx + PHP-FPM + Reverb)
exec /usr/bin/supervisord -c /var/www/html/docker/supervisor/supervisord.conf
