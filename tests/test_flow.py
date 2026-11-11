import os
import tempfile
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["HOST_PIN"] = "hhhh"
os.environ["WIFE_PIN"] = "wwww"

from app import push  # noqa: E402
from app.main import app  # noqa: E402

push.notify = lambda *a, **k: None  # no network in tests
import app.db as db  # noqa: E402
import app.main as m  # noqa: E402

m.push.notify = lambda *a, **k: None

F = "%Y-%m-%dT%H:%M"


def ts(days):
    return (datetime.now() + timedelta(days=days)).strftime(F)


@pytest.fixture(scope="module")
def clients():
    with TestClient(app) as host, TestClient(app) as wife:
        assert host.post("/api/login", json={"role": "host", "pin": "hhhh"}).status_code == 200
        assert wife.post("/api/login", json={"role": "wife", "pin": "wwww"}).status_code == 200
        yield host, wife


def test_auth_required_and_wrong_pin():
    with TestClient(app) as anon:
        assert anon.get("/api/gatherings").status_code == 401
        assert anon.post("/api/login", json={"role": "host", "pin": "nope"}).status_code == 401


def test_roles_enforced(clients):
    host, wife = clients
    assert wife.post("/api/gatherings", json={"title": "x", "start": ts(1)}).status_code == 403
    g = host.post("/api/gatherings", json={"title": "x", "start": ts(1)}).json()
    assert host.post(f"/api/gatherings/{g['id']}/respond", json={"decision": "approved"}).status_code == 403


def test_full_flow(clients):
    host, wife = clients
    grp = host.post("/api/groups", json={"name": "Uni crew", "target_days": 30}).json()
    g = host.post("/api/gatherings", json={"title": "Poker", "group_id": grp["id"], "start": ts(1)}).json()
    assert g["status"] == "pending"
    assert host.post(f"/api/gatherings/{g['id']}/start").status_code == 409  # not approved yet

    r = wife.post(f"/api/gatherings/{g['id']}/respond", json={"decision": "approved", "conditions": "Home by 11", "drink_limit": 3}).json()
    assert r["status"] == "approved" and r["drink_limit"] == 3

    assert host.post(f"/api/gatherings/{g['id']}/beers", json={"qty": 1}).status_code == 409  # not started
    assert host.post(f"/api/gatherings/{g['id']}/start").status_code == 200
    beer = host.get("/api/beer-types").json()[0]
    host.post(f"/api/gatherings/{g['id']}/beers", json={"beer_type_id": beer["id"], "qty": 2})
    g2 = host.post(f"/api/gatherings/{g['id']}/beers", json={"beer_type_id": beer["id"]}).json()
    assert g2["beers"]["total"] == 3

    detail = wife.get(f"/api/gatherings/{g['id']}").json()
    undone = host.delete(f"/api/beers/{detail['log'][0]['id']}").json()
    assert undone["beers"]["total"] == 2
    assert host.post(f"/api/gatherings/{g['id']}/end").status_code == 200
    assert host.post(f"/api/gatherings/{g['id']}/beers", json={}).status_code == 409  # ended


def test_reschedule_resets_approval(clients):
    host, wife = clients
    g = host.post("/api/gatherings", json={"title": "BBQ", "start": ts(5)}).json()
    wife.post(f"/api/gatherings/{g['id']}/respond", json={"decision": "approved"})
    body = {"title": "BBQ", "start": ts(6)}
    assert host.patch(f"/api/gatherings/{g['id']}", json=body).json()["status"] == "pending"


def test_ignored_request_expires(clients):
    host, _ = clients
    g = host.post("/api/gatherings", json={"title": "Old", "start": ts(-2)}).json()
    assert g["status"] == "expired"


def test_stats_and_overdue(clients):
    host, wife = clients
    grp = host.post("/api/groups", json={"name": "Work", "target_days": 14}).json()
    for d in (-60, -40, -20):
        g = host.post("/api/gatherings", json={"title": "Drinks", "group_id": grp["id"], "start": ts(d)}).json()
        wife.post(f"/api/gatherings/{g['id']}/respond", json={"decision": "approved"})
    s = next(x for x in wife.get("/api/stats").json()["groups"] if x["name"] == "Work")
    assert s["meetings"] == 3 and s["days_since"] in (19, 20) and s["avg_gap_days"] == 20.0 and s["overdue"] is True


def test_ics_feed(clients):
    host, wife = clients
    path = wife.get("/api/ics-url").json()["path"]
    with TestClient(app) as anon:
        assert anon.get("/calendar.ics?key=bad").status_code == 403
        body = anon.get(path).text
    assert "BEGIN:VCALENDAR" in body and "SUMMARY:Poker" in body and "Old" not in body


def test_push_subscribe(clients):
    _, wife = clients
    assert wife.get("/api/push/key").json()["key"]
    ok = {"endpoint": "https://fcm.googleapis.com/fcm/send/abc", "keys": {}}
    assert wife.post("/api/push/subscribe", json={"subscription": ok}).status_code == 200


def test_checked_in_future_gathering_counts_as_held(clients):
    host, wife = clients
    grp = host.post("/api/groups", json={"name": "Early birds"}).json()
    g = host.post("/api/gatherings", json={"title": "Early", "group_id": grp["id"], "start": ts(2)}).json()
    wife.post(f"/api/gatherings/{g['id']}/respond", json={"decision": "approved"})
    before = next(x for x in wife.get("/api/stats").json()["groups"] if x["name"] == "Early birds")
    assert before["meetings"] == 0
    host.post(f"/api/gatherings/{g['id']}/start")
    after = next(x for x in wife.get("/api/stats").json()["groups"] if x["name"] == "Early birds")
    assert after["meetings"] == 1 and after["days_since"] == 0 and not after["overdue"]


# ---------- security hardening ----------

def test_ics_text_cannot_inject_calendar_lines():
    from app.main import _ics_escape

    out = _ics_escape("Beers\r\nEND:VEVENT\r\nBEGIN:VEVENT\x00\x1b")
    assert "\r" not in out and "\n" not in out and "\x00" not in out and "\x1b" not in out
    assert out == "Beers\\nEND:VEVENT\\nBEGIN:VEVENT"


@pytest.mark.parametrize("endpoint", [
    "http://fcm.googleapis.com/x",          # not https
    "https://169.254.169.254/latest",       # cloud metadata
    "https://localhost:8088/api/x",         # internal service
    "https://evil.example.com/push",        # not a push service
    "https://fcm.googleapis.com.evil.io/x", # look-alike host
    "https://user@fcm.googleapis.com/x",    # credentials in URL
    "https://fcm.googleapis.com:8443/x",    # odd port
    "https://fcm.googleapis.com\\@evil.com/x",    # backslash: parsers disagree on the host
    "https://evil.com#@fcm.googleapis.com/x",    # fragment trick
    "https://evil.com\\.fcm.googleapis.com/x",
    "https://fcm.googleapis.com%2eevil.com/x",   # escaped dot in host
    "https://fcm.googleapis.com\t.evil.com/x",   # control character
    "https://fcm.googleapis.com /x",             # whitespace
])
def test_push_rejects_non_push_endpoints(clients, endpoint):
    _, wife = clients
    assert wife.post("/api/push/subscribe", json={"subscription": {"endpoint": endpoint}}).status_code == 422


def test_push_accepts_real_services(clients):
    _, wife = clients
    for ep in ("https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/abc", "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA%2bAbc%3d"):
        assert wife.post("/api/push/subscribe", json={"subscription": {"endpoint": ep}}).status_code == 200


def test_role_cannot_take_over_other_roles_push_endpoint(clients):
    host, wife = clients
    ep = {"endpoint": "https://fcm.googleapis.com/fcm/send/shared"}
    assert wife.post("/api/push/subscribe", json={"subscription": ep}).status_code == 200
    assert host.post("/api/push/subscribe", json={"subscription": ep}).status_code == 409


def test_login_locks_a_role_after_repeated_failures_and_alerts_host(monkeypatch, tmp_path):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "lock.db"))
    monkeypatch.setattr(m.time, "sleep", lambda *_: None)
    alerts = []
    monkeypatch.setattr(m.push, "notify", lambda *a, **k: alerts.append(a))
    with TestClient(app) as c:
        for _ in range(m.MAX_FAILS):
            assert c.post("/api/login", json={"role": "wife", "pin": "nope"}).status_code == 401
        assert c.post("/api/login", json={"role": "wife", "pin": "wwww"}).status_code == 429  # right PIN refused while locked
        assert c.post("/api/login", json={"role": "host", "pin": "hhhh"}).status_code == 200   # other role unaffected
    assert len(alerts) == 1 and alerts[0][0] == "host" and "locked" in alerts[0][1].lower()


def test_spoofed_forwarded_for_cannot_dodge_the_lock(monkeypatch, tmp_path):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "xff.db"))
    monkeypatch.setattr(m.time, "sleep", lambda *_: None)
    monkeypatch.setattr(m.push, "notify", lambda *a, **k: None)
    with TestClient(app) as c:
        for i in range(m.MAX_FAILS):
            assert c.post("/api/login", json={"role": "wife", "pin": "nope"}, headers={"X-Forwarded-For": f"10.0.0.{i}"}).status_code == 401
        assert c.post("/api/login", json={"role": "wife", "pin": "nope"}, headers={"X-Forwarded-For": "10.9.9.9"}).status_code == 429


def test_refuses_to_start_without_pins(monkeypatch, tmp_path):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "nopin.db"))
    monkeypatch.setattr(m, "PINS", {"host": "", "wife": "wwww"})
    with pytest.raises(RuntimeError, match="HOST_PIN"):
        with TestClient(app):
            pass


def test_frontend_assets_served_fresh():
    with TestClient(app) as anon:
        page = anon.get("/")
        assert page.status_code == 200 and 'type="module" src="/static/js/main.js"' in page.text
        for path in ("/static/js/main.js", "/static/js/views/calendar.js", "/static/style.css"):
            r = anon.get(path)
            assert r.status_code == 200 and r.headers["cache-control"] == "no-cache", path


# ---------- rhythm, map links, people ----------

def test_wife_can_change_group_rhythm_but_nothing_else(clients):
    host, wife = clients
    grp = host.post("/api/groups", json={"name": "Football", "target_days": 7}).json()
    assert wife.patch(f"/api/groups/{grp['id']}", json={"name": "Renamed"}).status_code == 403
    r = wife.put(f"/api/groups/{grp['id']}/rhythm", json={"target_days": 30})
    assert r.status_code == 200 and r.json()["target_days"] == 30 and r.json()["name"] == "Football"
    assert wife.put(f"/api/groups/{grp['id']}/rhythm", json={"target_days": None}).json()["target_days"] is None
    assert wife.put("/api/groups/99999/rhythm", json={"target_days": 7}).status_code == 404


@pytest.mark.parametrize("url,ok", [
    ("https://maps.app.goo.gl/AbCd123", True),
    ("https://www.google.com/maps/place/Bia+Hoi/@10.77,106.70,17z", True),
    ("", True),
    ("javascript:alert(1)", False),
    ("http://maps.google.com/x", False),
    ("https:///nohost", False),
    ("https://maps.app.goo.gl/a b", False),
])
def test_map_url_validation(clients, url, ok):
    host, _ = clients
    r = host.post("/api/gatherings", json={"title": "Bar", "start": ts(3), "location": "Bia Hoi", "map_url": url})
    assert (r.status_code == 201) is ok
    if ok:
        assert r.json()["map_url"] == url


def test_people_on_groups_and_gatherings_and_stats(clients):
    host, wife = clients
    grp = host.post("/api/groups", json={"name": "Neighbours", "members": ["Minh", "Lan", "minh"]}).json()
    assert grp["members"] == ["Lan", "Minh"]  # de-duplicated case-insensitively, sorted
    assert host.patch(f"/api/groups/{grp['id']}", json={"name": "Neighbours"}).json()["members"] == ["Lan", "Minh"]  # kept

    for d, people in ((-10, ["Minh", "Lan"]), (-3, ["Minh", "Tuan"]), (4, ["Minh"])):
        g = host.post("/api/gatherings", json={"title": "Hotpot", "group_id": grp["id"], "start": ts(d), "people": people}).json()
        assert g["people"] == sorted(people) and g["attendees"] == ", ".join(people)
        wife.post(f"/api/gatherings/{g['id']}/respond", json={"decision": "approved"})

    stats = {p["name"]: p for p in wife.get("/api/stats").json()["people"]}
    assert stats["Minh"]["meetings"] == 2  # the future one hasn't happened yet
    assert stats["Lan"]["meetings"] == 1 and stats["Tuan"]["meetings"] == 1
    assert {"Lan", "Minh", "Tuan"} <= set(wife.get("/api/people").json())


def test_legacy_attendees_text_is_split_into_people(clients):
    host, _ = clients
    g = host.post("/api/gatherings", json={"title": "Old app", "start": ts(2), "attendees": "An, Binh & Chi and Dung"}).json()
    assert g["people"] == ["An", "Binh", "Chi", "Dung"]


def test_old_database_is_migrated(monkeypatch, tmp_path):
    import sqlite3

    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT '#f59e0b', target_days INTEGER);
        CREATE TABLE beer_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, abv REAL, size_ml INTEGER, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE gatherings (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, group_id INTEGER, start TEXT NOT NULL, end TEXT,
            location TEXT NOT NULL DEFAULT '', attendees TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', ride TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending', wife_comment TEXT NOT NULL DEFAULT '', conditions TEXT NOT NULL DEFAULT '', drink_limit INTEGER,
            responded_at TEXT, started_at TEXT, ended_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
        INSERT INTO beer_types(name) VALUES ('Tiger');
        INSERT INTO gatherings(title, start, attendees) VALUES ('Legacy', '2026-01-01T19:00', 'Hai, Phong');
    """)
    old.close()
    monkeypatch.setattr(db, "DB_PATH", str(path))
    with TestClient(app) as c:
        assert c.post("/api/login", json={"role": "host", "pin": "hhhh"}).status_code == 200
        g = c.get("/api/gatherings").json()[0]
        assert g["people"] == ["Hai", "Phong"] and g["map_url"] == ""
        names = {b["name"] for b in c.get("/api/beer-types").json()}
        assert {"Tiger", "Tiger Crystal tall", "Budweiser short"} <= names
        bud = next(b for b in c.get("/api/beer-types").json() if b["name"] == "Budweiser short")
        c.delete(f"/api/beer-types/{bud['id']}")
    db.init()  # a restart must not bring a removed seed beer back
    with TestClient(app) as c:
        c.post("/api/login", json={"role": "host", "pin": "hhhh"})
        assert "Budweiser short" not in {b["name"] for b in c.get("/api/beer-types").json()}
