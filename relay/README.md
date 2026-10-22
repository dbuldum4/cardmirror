# CardMirror Advanced relay (self-hosting)

The self-hosted server for CardMirror Advanced's collaboration features — both
**card sharing** (store-and-forward mailbox) and **co-editing** (real-time
session rooms). Everything is **end-to-end encrypted by the app** —
this server only ever sees opaque ciphertext, a hashed routing code,
and timestamps. Mailbox messages are forgotten after 3 hours whether
or not they were delivered; co-editing rooms hold their (encrypted)
session log until the host ends the session or the room has been idle
for 7 days. New cards and session updates are live-pushed to connected
apps over SSE; the app also catches up by polling on every reconnect,
so nothing is lost while a machine is offline.

CardMirror Advanced does not provide a hosted relay. Deploy this server and
configure its URL and token in each participating app. Everyone sharing cards
or joining a co-editing session must point at the same relay. This independent
fork does not use the original project's hosted relay by default.

## Quick start (docker compose)

```sh
cd relay
RELAY_TOKEN=$(openssl rand -hex 24) docker compose up -d
```

Then in CardMirror Advanced on every machine: **Settings → Collaboration** →
**Custom relay URL** = `http://<your-host>:8410/relay`, **Custom relay
token** = the same token. Use HTTPS (a reverse proxy such as Caddy or
your platform's TLS) for anything beyond a LAN.

## Running it elsewhere

Any host that runs a Python process + Postgres works (Railway, Fly,
a VPS…). Requirements:

- env `DATABASE_URL` (Postgres) and `RELAY_TOKEN` (any long random
  string — it's the shared bearer, not the privacy mechanism).
- **Exactly one worker process** (`uvicorn server:app`, no
  `--workers`): the live-push registry is in-process.
- Recommended: `--limit-concurrency 4096` (the Dockerfile sets this) as
  a connection-storm backstop. It counts long-lived SSE streams too, so
  keep it far above the number of apps you expect connected at once.
- Required: `--timeout-graceful-shutdown 5` (the Dockerfile sets this).
  Without it a stopped instance waits forever for its open SSE streams
  and lingers as an unbound zombie that keeps heartbeating old clients
  while the new instance owns the port — their live pushes then go
  nowhere until the clients notice on their own.
- The tables are created automatically on first start.

Health check: `GET /relay/health` → `{"ok": true}` (no auth).

## Development tests

From the repository root, create an isolated Python environment and install the
runtime and HTTP test dependencies:

```sh
python3 -m venv work/relay-venv
work/relay-venv/bin/python -m pip install --upgrade 'pip>=26.2'
work/relay-venv/bin/python -m pip install -r relay/requirements-dev.txt
work/relay-venv/bin/python -m unittest discover -s relay -p 'test_*.py' -v
```

The default tests use in-process ASGI requests and fake database sessions; live
PostgreSQL tests skip unless configured. They do not run application startup or
use production secrets. Pure body-limit tests can also run with only Python's
standard library: `python3 -m unittest discover -s relay -p 'test_body_limits.py' -v`.

For real transaction/locking tests, point the following variables at a
**disposable test database** whose user can create and drop schemas:

```sh
export CARDMIRROR_TEST_POSTGRES_URL='postgresql+psycopg2://USER:PASSWORD@127.0.0.1:5432/TEST_DATABASE'
export CARDMIRROR_REQUIRE_POSTGRES=1
work/relay-venv/bin/python -m unittest discover -s relay -p 'test_*.py' -v
```

Each run creates a random test schema and drops only that schema afterward.
The URL is separate from deployment `DATABASE_URL`; never use a production
database for tests. Independent HTTP requests and PostgreSQL transactions cover
compaction/catch-up locks, deletion and GC races, commit-time response races,
storage limits, old-counter repair, pagination and SSE cleanup. CI runs all 44
relay tests against PostgreSQL 15 and 18 and fails if configuration is absent.

## Notes

- One `RELAY_TOKEN` covers both features — card sharing and co-editing
  sessions authenticate with the same shared bearer.
- Co-editing rooms: at most **10 people** per session (enforced at
  stream connect), 5 MB per update (the app chunks bigger ones),
  200 MB stored per room, counting encoded update and snapshot bytes. Old
  counters are repaired on the first write to a room in each process (and after
  bounded cache eviction); no schema migration is needed. An existing room over
  the corrected limit must compact below it before more updates are accepted.
  Deploy all relay workers together so old workers cannot restore raw-byte
  accounting. Future snapshot cursors and snapshots exceeding the total room
  budget are rejected without deleting stored updates.
- Payload cap 25 MB decompressed / 30 MB gzipped per send.
- Poll returns at most 100 messages, oldest first; the app deletes
  each message after it lands.
- CardMirror also works against a relay without the `/stream`
  endpoint by falling back to interval polling — but this server
  includes push, so you get instant delivery.
- Plugin allowlist: clients pointed at this relay ask it which GitHub
  repos the in-app plugin installer may install from
  (`GET /relay/plugin-allowlist`, no auth — public data). Configure
  the list with `RELAY_PLUGIN_ALLOWLIST` (comma-separated
  `owner/repo`); it defaults to the app's built-in list, so leaving it
  alone changes nothing. Plugins run with full access to CardMirror
  and your users' documents — curate deliberately. Individual users
  who want arbitrary repos can instead run
  `__plugins('community-on')` in the app's console.

The original [PolyForm Noncommercial License 1.0.0 and required notice](../LICENSE)
remain in effect, including Copyright (c) 2026 Anthony Trufanov. See the repository's
[third-party notices](../THIRD-PARTY-NOTICES.md) for dependency attributions.
