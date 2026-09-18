# Publicar en la VPS

Todo corre en un solo contenedor (API + WebSocket + juego compilado) más PostgreSQL. Nginx pone HTTPS delante.

## 1. En la VPS (una vez)

```bash
# Docker y nginx (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh
sudo apt install -y nginx certbot python3-certbot-nginx

git clone <tu-repo> volantines-reto && cd volantines-reto
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" > .env
docker compose -f docker-compose.prod.yml up -d --build
curl http://127.0.0.1:8787/api/health     # {"ok":true,"rooms":0,"players":0}
```

## 2. Dominio y HTTPS

1. Apunta un registro DNS `A` de tu dominio (ej. `volantines.tudominio.cl`) a la IP de la VPS.
2. Copia `deploy/nginx.conf` a `/etc/nginx/sites-available/volantines`, cambia el dominio y actívalo:

```bash
sudo ln -s /etc/nginx/sites-available/volantines /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d volantines.tudominio.cl
```

El WebSocket de las salas usa la misma dirección (`wss://…/ws`), nginx ya lo deja pasar.

## 3. Actualizar

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Las migraciones de la base de datos se aplican solas al arrancar.

## Respaldo de la base de datos

```bash
docker compose -f docker-compose.prod.yml exec db pg_dump -U volantines volantines > respaldo-$(date +%F).sql
```

## Capacidad

Cada sala simula sus bots y cruces a 20 Hz. Una VPS de 1 vCPU y 1 GB aguanta del orden de decenas de salas de 8 personas.
Cada jugador usa ~5 KB/s de subida y ~20–70 KB/s de bajada según cuántos haya en la sala.
