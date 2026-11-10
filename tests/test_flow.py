import os
import tempfile
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["HOST_PIN"] = "h"
os.environ["WIFE_PIN"] = "w"

from app import push  # noqa: E402
from app.main import app  # noqa: E402

push.notify = lambda *a, **k: None  # no network in tests
import app.main as m  # noqa: E402

m.push.notify = lambda *a, **k: None

F = "%Y-%m-%dT%H:%M"


def ts(days):
    return (datetime.now() + timedelta(days=days)).strftime(F)


@pytest.fixture(scope="module")
def clients():
    with TestClient(app) as host, TestClient(app) as wife:
        assert host.post("/api/login", json={"role": "host", "pin": "h"}).status_code == 200
        assert wife.post("/api/login", json={"role": "wife", "pin": "w"}).status_code == 200
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
    assert wife.post("/api/push/subscribe", json={"subscription": {"endpoint": "https://x/y", "keys": {}}}).status_code == 200


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
