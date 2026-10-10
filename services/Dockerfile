# Imagen común para los microservicios PHP. Uso:
#   docker build -f services/Dockerfile --build-arg SERVICE=auth --build-arg PORT=8081 services
FROM php:8.3-apache

RUN docker-php-ext-install pdo_mysql \
    && pecl install redis-6.1.0 && docker-php-ext-enable redis \
    && rm -rf /tmp/pear

ARG SERVICE
ARG PORT=8080
ENV SERVICE_PORT=${PORT}

# Apache en un puerto alto para poder correr sin root (A05 / hardening Docker).
RUN a2enmod rewrite headers \
    && sed -ri "s/^Listen 80$/Listen \${SERVICE_PORT}/" /etc/apache2/ports.conf \
    && sed -ri 's/^ServerTokens .*/ServerTokens Prod/; s/^ServerSignature .*/ServerSignature Off/' /etc/apache2/conf-available/security.conf \
    && printf '%s\n' \
      '<VirtualHost *:${SERVICE_PORT}>' \
      '  DocumentRoot /var/www/app/public' \
      '  <Directory /var/www/app/public>' \
      '    AllowOverride None' \
      '    Require all granted' \
      '    FallbackResource /index.php' \
      '    CGIPassAuth On' \
      '  </Directory>' \
      '  ErrorLog /dev/stderr' \
      '  CustomLog /dev/stdout combined' \
      '</VirtualHost>' > /etc/apache2/sites-available/000-default.conf \
    && printf '%s\n' 'expose_php = Off' 'display_errors = Off' 'log_errors = On' 'session.use_strict_mode = 1' \
       'date.timezone = America/Guatemala' > /usr/local/etc/php/conf.d/zz-seguridad.ini \
    && cp /usr/local/etc/php/php.ini-production /usr/local/etc/php/php.ini

COPY --chown=root:root shared /var/www/shared
COPY --chown=root:root ${SERVICE} /var/www/app

# El código es de root y de solo lectura para www-data.
USER www-data
EXPOSE ${PORT}
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD curl -fsS "http://localhost:${SERVICE_PORT}/salud" >/dev/null || exit 1
