FROM composer:latest

RUN sed -i 's/https/http/' /etc/apk/repositories \
    && apk add --no-cache \
    nginx \
    supervisor \
    php85-fpm \
    php85-pdo_mysql \
    php85-pcntl \
    php85-session \
    php85-dom \
    php85-xml \
    php85-xmlwriter \
    php85-simplexml \
    php85-tokenizer \
    php85-fileinfo \
    php85-ctype \
    php85-curl \
    php85-mbstring \
    php85-gd \
    && echo "extension=/usr/lib/php85/modules/pdo_mysql.so" > /usr/local/etc/php/conf.d/pdo_mysql.ini \
    && echo "extension=/usr/lib/php85/modules/pcntl.so" > /usr/local/etc/php/conf.d/pcntl.ini

WORKDIR /var/www/html

EXPOSE 8000 8080

ENTRYPOINT ["/var/www/html/docker/entrypoint.sh"]
