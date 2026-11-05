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

# Start Supervisor (Nginx + PHP-FPM + Reverb)
exec /usr/bin/supervisord -c /var/www/html/docker/supervisor/supervisord.conf
