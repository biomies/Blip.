FROM composer:latest
RUN docker-php-ext-install pdo_mysql
