"""Live PostgreSQL locking regressions; each run owns an isolated schema.

Set CARDMIRROR_TEST_POSTGRES_URL to a disposable PostgreSQL database. CI also
sets CARDMIRROR_REQUIRE_POSTGRES=1 so missing configuration cannot silently skip.
The ASGI requests use actual independent transactions, not database mocks.
"""
import asyncio
import json
import os
import threading
import time
import unittest
import uuid
from unittest.mock import patch

import httpx
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

with patch.dict(os.environ, {
    "DATABASE_URL": "postgresql+psycopg2://unused:unused@127.0.0.1:1/unused",
    "RELAY_TOKEN": "postgres-integration-test",
}):
    import server

POSTGRES_URL = os.getenv("CARDMIRROR_TEST_POSTGRES_URL")
if not POSTGRES_URL and os.getenv("CARDMIRROR_REQUIRE_POSTGRES") == "1":
    raise RuntimeError("CARDMIRROR_TEST_POSTGRES_URL is required for live PostgreSQL tests")


class Gate:
    def __init__(self, worker, fragment):
        self.worker = worker
        self.fragment = fragment
        self.entered = threading.Event()
        self.release = threading.Event()


@unittest.skipUnless(POSTGRES_URL, "set CARDMIRROR_TEST_POSTGRES_URL for live database tests")
class PostgreSQLRelayTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        url = make_url(POSTGRES_URL)
        if url.get_backend_name() != "postgresql":
            raise RuntimeError("Concurrency tests require real PostgreSQL")
        cls.schema = "cardmirror_test_" + uuid.uuid4().hex
        cls.admin = create_engine(url, connect_args={"connect_timeout": 5})
        with cls.admin.begin() as db:
            db.execute(text(f'CREATE SCHEMA "{cls.schema}"'))
        cls.engine = create_engine(url, pool_size=12, max_overflow=0, connect_args={
            "connect_timeout": 5,
            "options": f"-csearch_path={cls.schema} -clock_timeout=8000 -cstatement_timeout=12000",
        })
        cls.factory = sessionmaker(bind=cls.engine, autoflush=False, autocommit=False)
        try:
            server.Base.metadata.create_all(cls.engine)
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()
        with cls.admin.begin() as db:
            db.execute(text(f'DROP SCHEMA "{cls.schema}" CASCADE'))
        cls.admin.dispose()

    async def asyncSetUp(self):
        self.gates = []
        self.tasks = []
        self.pids = {}
        self.previous_overrides = server.app.dependency_overrides.copy()
        self.environment = patch.dict(os.environ, {"RELAY_TOKEN": "postgres-integration-test"})
        self.environment.start()

        def database(request: server.Request):
            with self.factory() as db:
                worker = request.headers.get("x-test-worker", "setup")
                conn = db.connection()
                conn.info["test_worker"] = worker
                self.pids[worker] = db.scalar(text("SELECT pg_backend_pid()"))
                yield db

        server.app.dependency_overrides[server.get_db] = database
        event.listen(self.engine, "after_cursor_execute", self.after_query)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app),
            base_url="http://test", headers={"Authorization": "Bearer postgres-integration-test"})
        self.addAsyncCleanup(self.finish)

    async def finish(self):
        for gate in self.gates:
            gate.release.set()
        if self.tasks:
            await asyncio.wait_for(asyncio.gather(*self.tasks, return_exceptions=True), 20)
        await self.client.aclose()
        event.remove(self.engine, "after_cursor_execute", self.after_query)
        server.app.dependency_overrides.clear()
        server.app.dependency_overrides.update(self.previous_overrides)
        self.environment.stop()

    def after_query(self, conn, cursor, statement, parameters, context, executemany):
        for gate in self.gates:
            if (conn.info.get("test_worker") == gate.worker and
                    gate.fragment in statement.lower() and not gate.entered.is_set()):
                gate.entered.set()
                if not gate.release.wait(10):
                    raise AssertionError("test did not release its database gate")

    def hold(self, worker, fragment):
        gate = Gate(worker, fragment)
        self.gates.append(gate)
        return gate

    async def entered(self, gate):
        self.assertTrue(await asyncio.to_thread(gate.entered.wait, 5), "request did not reach SQL gate")

    def start(self, worker, method, path, **kwargs):
        task = asyncio.create_task(self.client.request(method, path,
            headers={"x-test-worker": worker}, **kwargs))
        self.tasks.append(task)
        return task

    async def blocked(self, worker, blocker):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if worker in self.pids:
                with self.admin.connect() as observer:
                    blockers = observer.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": self.pids[worker]})
                if self.pids[blocker] in blockers:
                    return
            await asyncio.sleep(0.02)
        self.fail(f"PostgreSQL did not block {worker} behind {blocker}")

    async def room(self, updates=3):
        response = await self.client.post("/relay/rooms")
        self.assertEqual(response.status_code, 201)
        room = response.json()["roomId"]
        seqs = []
        for _ in range(updates):
            response = await self.client.post(f"/relay/rooms/{room}/updates", content=b"update")
            self.assertEqual(response.status_code, 202)
            seqs.append(response.json()["seq"])
        return room, seqs

    @staticmethod
    def snapshot(covers, blob="c25hcHNob3Q="):
        return {"coversThroughSeq": covers, "blob": blob}

    async def test_compactions_cannot_roll_back_a_newer_snapshot(self):
        for existing in (False, True):
            with self.subTest(existing_snapshot=existing):
                room, seqs = await self.room()
                if existing:
                    response = await self.client.post(f"/relay/rooms/{room}/snapshot", json=self.snapshot(seqs[0]))
                    self.assertEqual(response.status_code, 204)
                newer = f"newer-{existing}"
                older = f"older-{existing}"
                gate = self.hold(newer, "from relay_room_snapshots")
                first = self.start(newer, "POST", f"/relay/rooms/{room}/snapshot", json=self.snapshot(seqs[1], "bmV3ZXI="))
                await self.entered(gate)
                second = self.start(older, "POST", f"/relay/rooms/{room}/snapshot", json=self.snapshot(seqs[0], "b2xkZXI="))
                await self.blocked(older, newer)
                gate.release.set()
                self.assertEqual((await first).status_code, 204)
                self.assertEqual((await second).status_code, 204)
                data = (await self.client.get(f"/relay/rooms/{room}/updates")).json()
                self.assertEqual(data["snapshot"]["coversThroughSeq"], seqs[1])
                self.assertEqual(data["snapshot"]["blob"], "bmV3ZXI=")
                self.assertEqual([row["seq"] for row in data["updates"]], [seqs[2]])

    async def test_catchup_snapshot_and_tail_cannot_straddle_compaction(self):
        room, seqs = await self.room()
        await self.client.post(f"/relay/rooms/{room}/snapshot", json=self.snapshot(seqs[0]))
        gate = self.hold("reader", "from relay_room_snapshots")
        reader = self.start("reader", "GET", f"/relay/rooms/{room}/updates")
        await self.entered(gate)
        compact = self.start("compact", "POST", f"/relay/rooms/{room}/snapshot", json=self.snapshot(seqs[1]))
        await self.blocked("compact", "reader")
        gate.release.set()
        data = (await reader).json()
        self.assertEqual(data["snapshot"]["coversThroughSeq"], seqs[0])
        self.assertEqual([row["seq"] for row in data["updates"]], seqs[1:])
        self.assertEqual((await compact).status_code, 204)
        fresh = (await self.client.get(f"/relay/rooms/{room}/updates")).json()
        self.assertEqual(fresh["snapshot"]["coversThroughSeq"], seqs[1])
        self.assertEqual([row["seq"] for row in fresh["updates"]], seqs[2:])

    async def test_simultaneous_uploads_enforce_the_stored_room_capacity(self):
        room, _ = await self.room(0)
        gate = self.hold("first", "from relay_rooms")
        with patch.object(server, "ROOM_CAP_BYTES", 7):
            first = self.start("first", "POST", f"/relay/rooms/{room}/updates", content=b"ab")
            await self.entered(gate)
            second = self.start("second", "POST", f"/relay/rooms/{room}/updates", content=b"cd")
            await self.blocked("second", "first")
            gate.release.set()
            self.assertEqual((await first).status_code, 202)
            self.assertEqual((await second).status_code, 413)
        with self.factory() as db:
            row = db.get(server.RelayRoom, room)
            stored = db.query(server.RelayRoomUpdate).filter_by(room_id=room).all()
            self.assertEqual(row.bytes_used, sum(len(update.blob) for update in stored))

    async def test_deletion_waits_for_upload_then_removes_all_room_data(self):
        room, _ = await self.room(0)
        gate = self.hold("upload", "from relay_rooms")
        upload = self.start("upload", "POST", f"/relay/rooms/{room}/updates", content=b"pending")
        await self.entered(gate)
        deletion = self.start("delete", "DELETE", f"/relay/rooms/{room}")
        await self.blocked("delete", "upload")
        gate.release.set()
        self.assertEqual((await upload).status_code, 202)
        self.assertEqual((await deletion).status_code, 204)
        self.assertEqual((await self.client.delete(f"/relay/rooms/{room}")).status_code, 204)
        with self.factory() as db:
            self.assertTrue(db.get(server.RelayRoom, room).tombstoned)
            self.assertEqual(db.query(server.RelayRoomUpdate).filter_by(room_id=room).count(), 0)
            self.assertEqual(db.query(server.RelayRoomSnapshot).filter_by(room_id=room).count(), 0)

    async def test_upload_response_survives_compaction_immediately_after_commit(self):
        room, _ = await self.room(0)
        entered = threading.Event()
        release = threading.Event()
        def pause_committed_upload(session):
            if session.info.get("pause_upload"):
                entered.set()
                if not release.wait(10):
                    raise AssertionError("test did not release committed upload")
        # Tag the session on its update flush, and pause after the actual commit.
        def tag_upload(session, flush_context, instances):
            if any(isinstance(row, server.RelayRoomUpdate) for row in session.new):
                session.info["pause_upload"] = True
        event.listen(self.factory, "before_flush", tag_upload)
        event.listen(self.factory, "after_commit", pause_committed_upload)
        try:
            upload = self.start("committed", "POST", f"/relay/rooms/{room}/updates", content=b"update")
            self.assertTrue(await asyncio.to_thread(entered.wait, 5))
            with self.factory() as db:
                seq = db.query(server.RelayRoomUpdate.id).filter_by(room_id=room).scalar()
            compact = await self.client.post(f"/relay/rooms/{room}/snapshot", json=self.snapshot(seq))
            self.assertEqual(compact.status_code, 204)
            release.set()
            response = await upload
            self.assertEqual(response.status_code, 202)
            self.assertEqual(response.json()["seq"], seq)
        finally:
            release.set()
            await asyncio.gather(*self.tasks, return_exceptions=True)
            event.remove(self.factory, "before_flush", tag_upload)
            event.remove(self.factory, "after_commit", pause_committed_upload)

    async def test_future_snapshot_cursor_is_rejected_without_losing_updates(self):
        room, seqs = await self.room()
        response = await self.client.post(f"/relay/rooms/{room}/snapshot", json=self.snapshot(seqs[-1] + 100))
        self.assertEqual(response.status_code, 409)
        data = (await self.client.get(f"/relay/rooms/{room}/updates")).json()
        self.assertNotIn("snapshot", data)
        self.assertEqual([row["seq"] for row in data["updates"]], seqs)

    async def test_snapshot_budget_includes_the_retained_tail_and_rolls_back_on_refusal(self):
        room, seqs = await self.room(2)
        with patch.object(server, "ROOM_CAP_BYTES", 21):
            response = await self.client.post(f"/relay/rooms/{room}/snapshot",
                json=self.snapshot(seqs[0], "A" * 16))
        self.assertEqual(response.status_code, 413)
        data = (await self.client.get(f"/relay/rooms/{room}/updates")).json()
        self.assertNotIn("snapshot", data)
        self.assertEqual([row["seq"] for row in data["updates"]], seqs)
        with self.factory() as db:
            self.assertEqual(db.get(server.RelayRoom, room).bytes_used,
                sum(len(row["blob"]) for row in data["updates"]))

    async def test_idle_sweeper_skips_a_room_with_an_in_flight_upload(self):
        from datetime import datetime, timedelta
        room, _ = await self.room(0)
        with self.factory.begin() as db:
            db.get(server.RelayRoom, room).last_activity = datetime.utcnow() - server.ROOM_IDLE_GC - timedelta(days=1)
        gate = self.hold("active", "from relay_rooms")
        upload = self.start("active", "POST", f"/relay/rooms/{room}/updates", content=b"active")
        await self.entered(gate)
        def sweep():
            with self.factory() as db:
                return server._sweep(db)
        swept = asyncio.create_task(asyncio.to_thread(sweep))
        self.tasks.append(swept)
        done, _ = await asyncio.wait([swept], timeout=3)
        self.assertIn(swept, done, "idle cleanup waited on and endangered an active room")
        await swept
        gate.release.set()
        self.assertEqual((await upload).status_code, 202)
        self.assertEqual((await self.client.get(f"/relay/rooms/{room}/updates")).status_code, 200)

    async def test_idle_tombstone_survives_a_second_sweep_until_its_own_retention_expires(self):
        from datetime import datetime, timedelta
        room, _ = await self.room()
        with self.factory.begin() as db:
            db.get(server.RelayRoom, room).last_activity = datetime.utcnow() - server.ROOM_IDLE_GC - timedelta(days=1)
        for _ in range(2):
            with self.factory() as db:
                server._sweep(db)
            self.assertEqual((await self.client.get(f"/relay/rooms/{room}/updates")).status_code, 410)
        with self.factory.begin() as db:
            db.get(server.RelayRoom, room).last_activity = datetime.utcnow() - server.ROOM_IDLE_GC - timedelta(days=1)
        with self.factory() as db:
            server._sweep(db)
        self.assertEqual((await self.client.get(f"/relay/rooms/{room}/updates")).status_code, 404)

    async def test_mailbox_send_response_survives_the_receiver_deleting_after_commit(self):
        entered = threading.Event()
        release = threading.Event()
        frames = []
        class RecordingLoop:
            def call_soon_threadsafe(self, callback, *args):
                frames.append(args)
        def mark_message(session, flush_context, instances):
            if any(isinstance(row, server.RelayMessage) for row in session.new):
                session.info["pause_message"] = True
        def after_commit(session):
            if session.info.get("pause_message"):
                entered.set()
                if not release.wait(10):
                    raise AssertionError("mailbox commit gate was not released")
        event.listen(self.factory, "before_flush", mark_message)
        event.listen(self.factory, "after_commit", after_commit)
        try:
            with patch.object(server, "_loop", RecordingLoop()):
                recipient = "concurrency-test-recipient"
                sent = self.start("sender", "POST", "/relay/messages",
                    json={"recipientCode": recipient, "body": "encrypted"})
                self.assertTrue(await asyncio.to_thread(entered.wait, 5))
                received = (await self.client.get("/relay/messages", params={"recipient": recipient})).json()["messages"]
                self.assertEqual(len(received), 1)
                msg = received[0]
                self.assertEqual((await self.client.delete(f'/relay/messages/{msg["msgId"]}')).status_code, 204)
                release.set()
                response = await sent
                self.assertEqual(response.status_code, 202)
                self.assertEqual(response.json()["msgId"], msg["msgId"])
                self.assertEqual(frames[0][1]["receivedAt"], msg["receivedAt"])
        finally:
            release.set()
            await asyncio.gather(*self.tasks, return_exceptions=True)
            event.remove(self.factory, "before_flush", mark_message)
            event.remove(self.factory, "after_commit", after_commit)

    async def test_catchup_pagination_and_conditional_snapshot_after_compaction(self):
        room, seqs = await self.room()
        with patch.object(server, "MAX_UPDATES_PER_PAGE", 1):
            page = (await self.client.get(f"/relay/rooms/{room}/updates")).json()
            self.assertTrue(page["more"])
            self.assertEqual(page["lastSeq"], seqs[0])
            self.assertEqual((await self.client.post(f"/relay/rooms/{room}/snapshot",
                json=self.snapshot(seqs[1]))).status_code, 204)
            page = (await self.client.get(f"/relay/rooms/{room}/updates", params={"after": seqs[0]})).json()
            self.assertEqual(page["snapshot"]["coversThroughSeq"], seqs[1])
            self.assertEqual([row["seq"] for row in page["updates"]], [seqs[2]])
            conditional = (await self.client.get(f"/relay/rooms/{room}/updates",
                params={"after": 0, "haveSnap": seqs[1]})).json()
            self.assertTrue(conditional["snapshotUnchanged"])
            self.assertNotIn("snapshot", conditional)
            self.assertEqual(conditional["snapshotCovers"], seqs[1])
            self.assertEqual([row["seq"] for row in conditional["updates"]], [seqs[2]])

    async def test_snapshot_cursor_must_be_an_integer_and_utf8_size_is_accounted(self):
        room, seqs = await self.room()
        for invalid in (True, 1.5, "1", -1):
            response = await self.client.post(f"/relay/rooms/{room}/snapshot", json=self.snapshot(invalid))
            self.assertEqual(response.status_code, 400)
        with patch.object(server, "ROOM_CAP_BYTES", 5):
            # An opaque blob need not be interpreted, but its UTF-8 bytes count.
            response = await self.client.post(f"/relay/rooms/{room}/snapshot",
                json=self.snapshot(seqs[-1], "ééé"))
            self.assertEqual(response.status_code, 413)
        response = await self.client.post(f"/relay/rooms/{room}/snapshot",
            content=json.dumps(self.snapshot(seqs[-1], "\ud800")))
        self.assertEqual(response.status_code, 400)
        self.assertEqual((await self.client.post(f"/relay/rooms/{room}/snapshot",
            json=self.snapshot(seqs[-1], "ééé"))).status_code, 204)
        with self.factory() as db:
            self.assertEqual(db.get(server.RelayRoom, room).bytes_used, 6)

    async def test_open_sse_releases_its_database_connection_and_unregisters_on_close(self):
        from types import SimpleNamespace
        room, seqs = await self.room()
        baseline = self.engine.pool.checkedout()
        with self.factory() as db:
            response = await server.stream_room(SimpleNamespace(), room, sid="test", db=db)
            self.assertEqual(self.engine.pool.checkedout(), baseline)
            try:
                hello = await anext(response.body_iterator)
                self.assertIn(str(seqs[-1]), hello)
                self.assertEqual(len(server._room_streams[room]), 1)
                self.assertEqual(self.engine.pool.checkedout(), baseline)
            finally:
                await response.body_iterator.aclose()
        self.assertNotIn(room, server._room_streams)

    async def test_disconnect_before_sse_body_does_not_leave_a_registered_listener(self):
        from starlette.requests import ClientDisconnect
        room, _ = await self.room()
        for path, registry, key in (
            (f"/relay/rooms/{room}/stream", server._room_streams, room),
            ("/relay/stream?recipient=disconnect-test", server._streams, "disconnect-test"),
        ):
            with self.subTest(path=path):
                route, _, query = path.partition("?")
                scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
                    "http_version": "1.1", "method": "GET", "scheme": "http", "path": route,
                    "raw_path": route.encode(), "query_string": query.encode(), "root_path": "",
                    "headers": [(b"authorization", b"Bearer postgres-integration-test")],
                    "server": ("test", 80), "client": ("127.0.0.1", 1234)}
                async def receive():
                    return {"type": "http.request", "body": b"", "more_body": False}
                async def send(message):
                    if message["type"] == "http.response.start":
                        raise ConnectionResetError("peer disconnected before first body chunk")
                with self.assertRaises((ClientDisconnect, ConnectionResetError)):
                    await server.app(scope, receive, send)
                # Clear test-owned leaked queues even if the assertion fails.
                remaining = registry.pop(key, None)
                self.assertIsNone(remaining)

    async def test_existing_room_accounting_is_repaired_before_accepting_new_data(self):
        room, seqs = await self.room(1)
        with self.factory.begin() as db:
            # Simulate a database created by the old raw-byte accounting code.
            db.get(server.RelayRoom, room).bytes_used = len(b"update")
        with patch.object(server, "_accounted_rooms", server.OrderedDict()):
            with patch.object(server, "ROOM_CAP_BYTES", 11):
                # Refusal rolls back the repair. A retry must not trust a cache
                # entry for the old, understated counter.
                for _ in range(2):
                    refused = await self.client.post(f"/relay/rooms/{room}/updates", content=b"x")
                    self.assertEqual(refused.status_code, 413)
            data = (await self.client.get(f"/relay/rooms/{room}/updates")).json()
            self.assertEqual([row["seq"] for row in data["updates"]], seqs)
            accepted = await self.client.post(f"/relay/rooms/{room}/updates", content=b"x")
            self.assertEqual(accepted.status_code, 202)
        with self.factory() as db:
            self.assertEqual(db.get(server.RelayRoom, room).bytes_used, len("dXBkYXRl") + len("eA=="))
