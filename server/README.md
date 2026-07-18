# makegtd sync server

A zero-dependency (stdlib-only) Go reference server for makegtd's
self-hosted sync provider ("Servidor propio" in Ajustes → Sincronización).
It stores the app's per-device files as opaque blobs: payloads are
end-to-end encrypted on the device before upload, so the server can never
read GTD data — it only needs to be reachable and to keep the files safe.

## Run

```bash
# Generate an access key (any long random string works):
openssl rand -base64 24

ACCESS_KEY=<the key> \
DATA_DIR=/var/lib/makegtd-sync \
ALLOWED_ORIGIN=https://your-makegtd-host \
go run ./server
```

Or build a small static binary once and deploy it anywhere (no runtime
needed on the host):

```bash
go build -o makegtd-sync ./server          # current platform
GOOS=linux GOARCH=arm64 go build -o makegtd-sync ./server   # e.g. a Raspberry Pi
```

Environment variables:

| Variable         | Default           | Purpose                                              |
| ---------------- | ----------------- | ---------------------------------------------------- |
| `ACCESS_KEY`     | — (required)      | Bearer key every device must present.                |
| `PORT`           | `8787`            | Listen port.                                         |
| `DATA_DIR`       | `./gtd-sync-data` | Where the encrypted files are stored.                |
| `ALLOWED_ORIGIN` | `*`               | CORS origin of the app; tighten it in production.    |

## TLS

Browsers block plain-http requests from an https-served app, so put the
server behind TLS with whatever you already use: a reverse proxy (Caddy,
nginx), a Cloudflare Tunnel, or your PaaS of choice. `http://localhost` and
plain-http LAN addresses only work when the app itself is served over http.

Example with Caddy (automatic HTTPS):

```
sync.example.com {
    reverse_proxy localhost:8787
}
```

## Connect the app

In makegtd: Ajustes → Sincronización → «Servidor propio», enter the server
URL and the access key, choose an encryption passphrase and sync. Then use
«Descargar archivo de llave» to export a password-encrypted key file and
import it on your other devices instead of typing everything again.

## Protocol

Any implementation of these three endpoints works as a backend (the storage
behind them is your choice — a disk directory here; S3 or anything else in
alternative implementations). All requests carry
`Authorization: Bearer <ACCESS_KEY>`; CORS must allow the app's origin with
the `Authorization` and `Content-Type` headers.

```
GET  /gtd/files          -> 200 {"files":[{"name":"gtd-device-<id>.json","modifiedAt":"…"}]}
GET  /gtd/files/{name}   -> 200 raw stored content | 404
PUT  /gtd/files/{name}   -> 200 {"name":"…"}   (stores the raw request body)
```

File names always match `gtd-device-<id>.json`; reject anything else
(the reference implementation does, which also rules out path traversal).
