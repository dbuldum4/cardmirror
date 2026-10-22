"""HTTP contract checks using an in-process app and a fake database session.

Install requirements-dev.txt, then run unittest discovery from the repo root.
ASGITransport deliberately does not run application startup, which would create
PostgreSQL tables and launch the production sweeper.
"""

import gzip
import json
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import httpx

TEST_ENV = {
    "DATABASE_URL": "postgresql+psycopg2://relay-test:relay-test@127.0.0.1:1/relay-test",
    "RELAY_TOKEN": "relay-http-test-token",
    "RELAY_MIN_CLIENT_VERSION": "",
    "RELAY_MIN_VERSION_SCOPE": "off",
}
with patch.dict(os.environ, TEST_ENV):
    import server


class FakeSession:
    def __init__(self):
        self.rows = []
        self.commits = 0

    def add(self, row):
        row.created_at = datetime.now(timezone.utc).replace(tzinfo=None)
        self.rows.append(row)

    def commit(self):
        self.commits += 1

    def query(self, *args):
        raise AssertionError("unexpected database query")


class ChunkedRequest:
    """Supply controlled ASGI chunks to verify when the app stops receiving."""

    def __init__(self, app, chunks):
        self.app = app
        self.chunks = chunks
        self.received = 0

    async def __call__(self, scope, receive, send):
        async def receive_chunk():
            if self.received < len(self.chunks):
                chunk = self.chunks[self.received]
                self.received += 1
                return {
                    "type": "http.request",
                    "body": chunk,
                    "more_body": self.received < len(self.chunks),
                }
            return await receive()

        await self.app(scope, receive_chunk, send)


class RelayHTTPTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.environment = patch.dict(os.environ, TEST_ENV)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        # Fail immediately if any tested path tries to open a real connection.
        self.connection_guard = patch.object(
            server.engine, "connect", side_effect=AssertionError("database access forbidden")
        )
        self.connection_guard.start()
        self.addCleanup(self.connection_guard.stop)
        self.driver_guard = patch(
            "psycopg2.connect", side_effect=AssertionError("network database access forbidden")
        )
        self.driver_guard.start()
        self.addCleanup(self.driver_guard.stop)
        self.network_guard = patch(
            "socket.socket.connect", side_effect=AssertionError("network connections forbidden")
        )
        self.network_guard.start()
        self.addCleanup(self.network_guard.stop)
        self.db = FakeSession()
        self.db_dependencies = 0

        def get_fake_db():
            self.db_dependencies += 1
            yield self.db

        previous = server.app.dependency_overrides.copy()
        server.app.dependency_overrides[server.get_db] = get_fake_db
        self.addCleanup(lambda: setattr(server.app, "dependency_overrides", previous))
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=server.app), base_url="http://test"
        )
        self.addAsyncCleanup(self.client.aclose)
        self.headers = {"Authorization": "Bearer " + TEST_ENV["RELAY_TOKEN"]}
        self.payload = {"recipientCode": "AbCdEf0123456789_-abcdQ", "body": "opaque"}

    async def test_health_does_not_require_auth_or_database(self):
        response = await self.client.get("/relay/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        self.assertEqual(self.db_dependencies, 0)

    async def test_auth_rejects_before_body_processing_or_database(self):
        routes = (
            "/relay/messages",
            "/relay/rooms/test/updates",
            "/relay/rooms/test/snapshot",
            "/relay/rooms/test/presence",
        )
        with patch.object(server, "read_bounded_body", side_effect=AssertionError("body read before auth")):
            for route in routes:
                for authorization in (None, "Bearer wrong-token"):
                    headers = {"Content-Encoding": "br"}
                    if authorization:
                        headers["Authorization"] = authorization
                    with self.subTest(route=route, authorization=authorization):
                        response = await self.client.post(route, content=b"untrusted", headers=headers)
                        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.db_dependencies, 0)

    async def test_plain_and_identity_mailbox_payloads_are_stored(self):
        for encoding in (None, "identity", " IDENTITY "):
            headers = dict(self.headers)
            if encoding is not None:
                headers["Content-Encoding"] = encoding
            with self.subTest(encoding=encoding):
                response = await self.client.post("/relay/messages", json=self.payload, headers=headers)
                self.assertEqual(response.status_code, 202)
                self.assertEqual(len(response.json()["msgId"]), 32)
                self.assertEqual(self.db.rows[-1].body, self.payload)
                self.assertEqual(self.db.rows[-1].recipient_code, self.payload["recipientCode"])
        self.assertEqual(self.db.commits, 3)

    async def test_valid_gzip_and_concatenated_members_are_stored(self):
        raw = json.dumps(self.payload).encode()
        bodies = (gzip.compress(raw), gzip.compress(raw[:10]) + gzip.compress(raw[10:]))
        for body in bodies:
            response = await self.client.post(
                "/relay/messages", content=body,
                headers={**self.headers, "Content-Encoding": "GZIP"},
            )
            self.assertEqual(response.status_code, 202)
            self.assertEqual(self.db.rows[-1].body, self.payload)

    async def test_unsupported_encoding_is_rejected_before_reading(self):
        encodings = ("br", "notgzip", "gzip, br", "gzip, identity", "")
        with patch.object(server, "read_bounded_body", side_effect=AssertionError("unsupported body read")):
            for encoding in encodings:
                with self.subTest(encoding=encoding):
                    response = await self.client.post(
                        "/relay/messages", content=b"ignored",
                        headers={**self.headers, "Content-Encoding": encoding},
                    )
                    self.assertEqual(response.status_code, 415)
        self.assertEqual(self.db_dependencies, 0)

    async def test_duplicate_encoding_headers_are_rejected(self):
        response = await self.client.post(
            "/relay/messages", content=gzip.compress(json.dumps(self.payload).encode()),
            headers=[*self.headers.items(), ("Content-Encoding", "gzip"), ("Content-Encoding", "br")],
        )
        self.assertEqual(response.status_code, 415)
        self.assertEqual(self.db.rows, [])

    async def test_invalid_gzip_never_commits(self):
        valid = gzip.compress(json.dumps(self.payload).encode())
        corrupt = bytearray(valid)
        corrupt[-8] ^= 1
        for body in (b"", b"not gzip", valid[:-1], valid + b"junk", bytes(corrupt)):
            with self.subTest(body=body):
                response = await self.client.post(
                    "/relay/messages", content=body,
                    headers={**self.headers, "Content-Encoding": "gzip"},
                )
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.db.commits, 0)

    async def test_decompressed_size_limit_is_413(self):
        with patch.object(server, "MAX_BYTES", 16):
            response = await self.client.post(
                "/relay/messages", content=gzip.compress(json.dumps(self.payload).encode()),
                headers={**self.headers, "Content-Encoding": "gzip"},
            )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.db.commits, 0)

    async def test_streaming_limits_stop_each_endpoint_after_overflow(self):
        cases = (
            ("/relay/messages", "MAX_BYTES", None),
            ("/relay/messages", "MAX_COMPRESSED_BYTES", "gzip"),
            ("/relay/rooms/test/updates", "MAX_UPDATE_BYTES", None),
            ("/relay/rooms/test/snapshot", "MAX_SNAPSHOT_BYTES", None),
            ("/relay/rooms/test/presence", "MAX_PRESENCE_BYTES", None),
        )
        for route, limit_name, encoding in cases:
            with self.subTest(route=route, limit_name=limit_name):
                app = ChunkedRequest(server.app, [b"abc", b"de", b"must not be read"])
                client = httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://test"
                )
                headers = dict(self.headers)
                if encoding:
                    headers["Content-Encoding"] = encoding
                try:
                    with patch.object(server, limit_name, 4):
                        response = await client.post(route, content=b"", headers=headers)
                finally:
                    await client.aclose()
                self.assertEqual(response.status_code, 413)
                self.assertEqual(app.received, 2)
        self.assertEqual(self.db.commits, 0)

    async def test_valid_presence_at_limit_and_empty_presence(self):
        with patch.object(server, "MAX_PRESENCE_BYTES", 4):
            response = await self.client.post(
                "/relay/rooms/test/presence", content=b"abcd", headers=self.headers
            )
            self.assertEqual(response.status_code, 202)
            response = await self.client.post(
                "/relay/rooms/test/presence", content=b"", headers=self.headers
            )
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.db_dependencies, 0)

    async def test_recipient_codes_reject_oversized_and_control_characters(self):
        for recipient in ("x" * 257, "bad\ncode", "bad\rlog", "bad\x00code", "bad\x7fcode"):
            with self.subTest(recipient=recipient):
                response = await self.client.post(
                    "/relay/messages", json={**self.payload, "recipientCode": recipient}, headers=self.headers
                )
                self.assertEqual(response.status_code, 400)
                for route in ("/relay/messages", "/relay/stream"):
                    response = await self.client.get(route, params={"recipient": recipient}, headers=self.headers)
                    self.assertIn(response.status_code, (400, 422))
        self.assertEqual(self.db.rows, [])

    async def test_short_printable_custom_recipient_is_preserved(self):
        payload = {**self.payload, "recipientCode": "custom-recipient_1"}
        response = await self.client.post("/relay/messages", json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.db.rows[0].recipient_code, payload["recipientCode"])

    async def test_recipient_at_maximum_length_is_preserved(self):
        recipient = "x" * server.MAX_ROUTING_CODE_LENGTH
        response = await self.client.post(
            "/relay/messages", json={**self.payload, "recipientCode": recipient}, headers=self.headers
        )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.db.rows[0].recipient_code, recipient)


if __name__ == "__main__":
    unittest.main()
