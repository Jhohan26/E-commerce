FROM php:8.2-apache
RUN apt-get update && apt-get install -y --no-install-recommends libonig-dev unzip && docker-php-ext-install pdo_mysql mbstring sockets && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
WORKDIR /var/www/pagos
COPY composer.json composer.lock ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-scripts --no-plugins --no-autoloader
COPY bootstrap.php ./
COPY src/ ./src/
COPY bin/ ./bin/
COPY public/ ./public/
RUN composer dump-autoload --no-dev --classmap-authoritative --no-scripts && rm -f public/secure-test.php && cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"
RUN printf '%s\n' '<VirtualHost *:80>' 'DocumentRoot /var/www/pagos/public' '<Directory /var/www/pagos/public>' 'Options -Indexes' 'AllowOverride None' 'Require all granted' 'DirectoryIndex index.php' 'SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1' '<FilesMatch "^_.*\\.php$">' 'Require all denied' '</FilesMatch>' '</Directory>' '</VirtualHost>' > /etc/apache2/sites-available/000-default.conf
EXPOSE 80
CMD ["apache2-foreground"]
