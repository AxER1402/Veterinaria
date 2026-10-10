proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
# Se SOBRESCRIBEN (no se encadenan) para que el cliente no pueda falsear su IP.
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 3s;
proxy_read_timeout 15s;
proxy_hide_header X-Powered-By;
proxy_hide_header Server;
