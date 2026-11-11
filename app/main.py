import hashlib
import hmac
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import db, push

logging.basicConfig(level=logging.INFO)
STATIC = Path(__file__).parent / "static"
PINS = {"host": os.environ.get("HOST_PIN", ""), "wife": os.environ.get("WIFE_PIN", "")}
MIN_PIN_LEN = 4
# Wrong PINs: 5 per role locks sign-in for that role for 15 minutes (failures expire). Client headers such as
# X-Forwarded-For are deliberately not trusted for this. Existing sessions last 180 days, so the wife rarely
# signs in; the host is alerted by push when a lock triggers.
MAX_FAILS, FAIL_WINDOW = 5, 15 * 60
CONTACT = os.environ.get("VAPID_CONTACT", "mailto:admin@example.com")
SESSION_TTL = 60 * 60 * 24 * 180
FMT = "%Y-%m-%dT%H:%M"

@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    with db.session() as c:
        db.ensure_secret(c, "session_secret")
        db.ensure_secret(c, "ics_key")
    push.vapid_keys()
    bad = [r for r, v in PINS.items() if len(v) < MIN_PIN_LEN]
    if bad and os.environ.get("ALLOW_INSECURE_DEV") != "1":
        raise RuntimeError(f"Set {' and '.join(r.upper() + '_PIN' for r in bad)} (at least {MIN_PIN_LEN} characters) before starting")
    yield


app = FastAPI(title="Evenings", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


# ---------- auth ----------

def _secret() -> bytes:
    with db.session() as c:
        return db.ensure_secret(c, "session_secret").encode()


def _sign(role: str, exp: int) -> str:
    msg = f"{role}.{exp}"
    return f"{msg}.{hmac.new(_secret(), msg.encode(), hashlib.sha256).hexdigest()}"


def _role_from_cookie(request: Request) -> Optional[str]:
    tok = request.cookies.get("session", "")
    try:
        role, exp, sig = tok.split(".")
        good = hmac.new(_secret(), f"{role}.{exp}".encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(sig, good) and int(exp) > time.time() and role in PINS:
            return role
    except ValueError:
        pass
    return None


def require(*roles: str):
    def dep(request: Request) -> str:
        role = _role_from_cookie(request)
        if role is None:
            raise HTTPException(401, "Please log in")
        if roles and role not in roles:
            raise HTTPException(403, "Not allowed for your role")
        return role

    return dep


class Login(BaseModel):
    role: Literal["host", "wife"]
    pin: str


@app.post("/api/login")
def login(body: Login, response: Response):
    now = int(time.time())
    locked_now = False
    with db.session() as c:
        c.execute("DELETE FROM login_failures WHERE ts < ?", (now - FAIL_WINDOW,))
        fails = c.execute("SELECT COUNT(*) FROM login_failures WHERE role=?", (body.role,)).fetchone()[0]
        if fails >= MAX_FAILS:
            raise HTTPException(429, "Too many wrong PINs. Try again in a few minutes.")
        ok = len(PINS[body.role]) >= MIN_PIN_LEN and hmac.compare_digest(body.pin, PINS[body.role])
        if not ok:
            c.execute("INSERT INTO login_failures(role, ts) VALUES (?,?)", (body.role, now))
            locked_now = fails + 1 >= MAX_FAILS
    if not ok:
        if locked_now:
            push.notify("host", "Sign-in locked", f"{MAX_FAILS} wrong PINs for the {body.role} login. It unlocks in {FAIL_WINDOW // 60} minutes.", "/", CONTACT)
        time.sleep(0.5)
        raise HTTPException(401, "Wrong PIN")
    exp = int(time.time()) + SESSION_TTL
    response.set_cookie("session", _sign(body.role, exp), max_age=SESSION_TTL, httponly=True, samesite="lax", secure=False)
    return {"role": body.role}


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie("session")
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    return {"role": _role_from_cookie(request)}


@app.get("/health")
def health():
    return {"ok": True}


# ---------- helpers ----------

def _parse(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.strptime(s, FMT)
    except ValueError:
        raise HTTPException(422, f"Bad datetime '{s}', expected YYYY-MM-DDTHH:MM")


def effective_status(row, now: datetime) -> str:
    """A request nobody answered before it started is 'expired' (the ignore case)."""
    if row["status"] == "pending" and datetime.strptime(row["start"], FMT) < now:
        return "expired"
    return row["status"]


def _beer_summary(c, ids: list[int]) -> dict[int, dict]:
    out: dict[int, dict] = {i: {"total": 0, "by_type": []} for i in ids}
    if not ids:
        return out
    q = ",".join("?" * len(ids))
    rows = c.execute(
        f"""SELECT l.gathering_id gid, COALESCE(t.name,'Other') name, SUM(l.qty) qty
            FROM beer_log l LEFT JOIN beer_types t ON t.id=l.beer_type_id
            WHERE l.gathering_id IN ({q}) GROUP BY l.gathering_id, name ORDER BY qty DESC""",
        ids,
    ).fetchall()
    for r in rows:
        out[r["gid"]]["total"] += r["qty"]
        out[r["gid"]]["by_type"].append({"name": r["name"], "qty": r["qty"]})
    return out


def _people_of(c, table: str, key: str, ids: list[int]) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {i: [] for i in ids}
    if not ids:
        return out
    q = ",".join("?" * len(ids))
    rows = c.execute(
        f"SELECT x.{key} owner, p.name FROM {table} x JOIN people p ON p.id=x.person_id WHERE x.{key} IN ({q}) ORDER BY p.name COLLATE NOCASE",
        ids,
    ).fetchall()
    for r in rows:
        out[r["owner"]].append(r["name"])
    return out


def _groups(c, where: str = "", args: tuple = ()) -> list[dict]:
    rows = [dict(r) for r in c.execute(f"SELECT * FROM groups {where} ORDER BY name", args)]
    members = _people_of(c, "group_members", "group_id", [r["id"] for r in rows])
    for r in rows:
        r["members"] = members[r["id"]]
    return rows


def _group(c, grp: int) -> dict:
    rows = _groups(c, "WHERE id=?", (grp,))
    if not rows:
        raise HTTPException(404, "Group not found")
    return rows[0]


def _gatherings(c, where: str = "", args: tuple = ()) -> list[dict]:
    now = datetime.now()
    rows = c.execute(
        f"""SELECT g.*, gr.name group_name, gr.color group_color FROM gatherings g
            LEFT JOIN groups gr ON gr.id=g.group_id {where} ORDER BY g.start""",
        args,
    ).fetchall()
    ids = [r["id"] for r in rows]
    beers = _beer_summary(c, ids)
    people = _people_of(c, "gathering_people", "gathering_id", ids)
    out = []
    for r in rows:
        d = dict(r)
        d["status"] = effective_status(r, now)
        d["beers"] = beers[r["id"]]
        d["people"] = people[r["id"]]
        out.append(d)
    return out


def _one(c, gid: int) -> dict:
    rows = _gatherings(c, "WHERE g.id=?", (gid,))
    if not rows:
        raise HTTPException(404, "Gathering not found")
    return rows[0]


def _fmt_when(s: str) -> str:
    return datetime.strptime(s, FMT).strftime("%a %d %b, %H:%M")


# ---------- gatherings ----------

def _clean_names(names: list[str]) -> list[str]:
    return db.split_names("\n".join(n.replace(",", " ") for n in names))


def _check_map_url(v: str) -> str:
    """A map link must be a plain https URL (rendered as a link, so no javascript: and friends)."""
    v = v.strip()
    if not v:
        return ""
    parts = urlsplit(v)
    if parts.scheme != "https" or not parts.hostname or any(ch.isspace() or ord(ch) < 32 for ch in v):
        raise ValueError("Map link must be an https:// link, e.g. from Google Maps → Share")
    return v


PeopleList = list[str]


class GatheringIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    group_id: Optional[int] = None
    start: str
    end: Optional[str] = None
    location: str = Field("", max_length=200)
    map_url: str = Field("", max_length=500)
    people: PeopleList = Field(default_factory=list, max_length=50)
    attendees: str = Field("", max_length=300)  # legacy free text, used only when `people` is empty
    note: str = Field("", max_length=1000)
    ride: str = Field("", max_length=200)

    @field_validator("map_url")
    @classmethod
    def _map(cls, v: str) -> str:
        return _check_map_url(v)

    def names(self) -> list[str]:
        return _clean_names(self.people) if self.people else db.split_names(self.attendees)


def _check_times(start: str, end: Optional[str]) -> None:
    s, e = _parse(start), _parse(end)
    if e and e <= s:
        raise HTTPException(422, "End must be after start")


@app.get("/api/gatherings")
def list_gatherings(start: Optional[str] = None, end: Optional[str] = None, _: str = Depends(require())):
    where, args = [], []
    if start:
        where.append("g.start >= ?")
        args.append(start)
    if end:
        where.append("g.start <= ?")
        args.append(end)
    with db.session() as c:
        return _gatherings(c, ("WHERE " + " AND ".join(where)) if where else "", tuple(args))


@app.get("/api/gatherings/{gid}")
def get_gathering(gid: int, _: str = Depends(require())):
    with db.session() as c:
        g = _one(c, gid)
        g["log"] = [
            dict(r)
            for r in c.execute(
                """SELECT l.id, l.qty, l.ts, COALESCE(t.name,'Other') name FROM beer_log l
                   LEFT JOIN beer_types t ON t.id=l.beer_type_id WHERE l.gathering_id=? ORDER BY l.ts DESC, l.id DESC""",
                (gid,),
            )
        ]
        return g


@app.post("/api/gatherings", status_code=201)
def create_gathering(body: GatheringIn, _: str = Depends(require("host"))):
    _check_times(body.start, body.end)
    names = body.names()
    with db.session() as c:
        cur = c.execute(
            "INSERT INTO gatherings(title, group_id, start, end, location, map_url, attendees, note, ride) VALUES (?,?,?,?,?,?,?,?,?)",
            (body.title, body.group_id, body.start, body.end, body.location, body.map_url, ", ".join(names), body.note, body.ride),
        )
        db.set_people(c, "gathering_people", "gathering_id", cur.lastrowid, names)
        g = _one(c, cur.lastrowid)
    push.notify("wife", "New request", f"{g['title']} · {_fmt_when(g['start'])}", "/", CONTACT)
    return g


@app.patch("/api/gatherings/{gid}")
def update_gathering(gid: int, body: GatheringIn, _: str = Depends(require("host"))):
    _check_times(body.start, body.end)
    names = body.names()
    with db.session() as c:
        old = _one(c, gid)
        if old["started_at"]:
            raise HTTPException(409, "Already started; can't edit")
        changed = (old["start"], old["end"]) != (body.start, body.end)
        # Moving an answered request means it needs a fresh answer.
        reset = changed and old["status"] in ("approved", "declined")
        c.execute(
            """UPDATE gatherings SET title=?, group_id=?, start=?, end=?, location=?, map_url=?, attendees=?, note=?, ride=?,
               status=CASE WHEN ? THEN 'pending' ELSE status END,
               responded_at=CASE WHEN ? THEN NULL ELSE responded_at END WHERE id=?""",
            (body.title, body.group_id, body.start, body.end, body.location, body.map_url, ", ".join(names), body.note, body.ride, reset, reset, gid),
        )
        db.set_people(c, "gathering_people", "gathering_id", gid, names)
        g = _one(c, gid)
    if reset or (changed and g["status"] == "pending"):
        push.notify("wife", "Request updated", f"{g['title']} · {_fmt_when(g['start'])}", "/", CONTACT)
    return g


@app.delete("/api/gatherings/{gid}")
def delete_gathering(gid: int, _: str = Depends(require("host"))):
    with db.session() as c:
        c.execute("DELETE FROM gatherings WHERE id=?", (gid,))
    return {"ok": True}


class Respond(BaseModel):
    decision: Literal["approved", "declined"]
    comment: str = Field("", max_length=500)
    conditions: str = Field("", max_length=300)
    drink_limit: Optional[int] = Field(None, ge=0, le=100)


@app.post("/api/gatherings/{gid}/respond")
def respond(gid: int, body: Respond, _: str = Depends(require("wife"))):
    with db.session() as c:
        g = _one(c, gid)
        if g["started_at"]:
            raise HTTPException(409, "Gathering already started")
        c.execute(
            "UPDATE gatherings SET status=?, wife_comment=?, conditions=?, drink_limit=?, responded_at=datetime('now','localtime') WHERE id=?",
            (body.decision, body.comment, body.conditions if body.decision == "approved" else "", body.drink_limit if body.decision == "approved" else None, gid),
        )
        g = _one(c, gid)
    push.notify("host", f"{g['title']}: {body.decision}", body.comment or body.conditions or _fmt_when(g["start"]), "/", CONTACT)
    return g


@app.post("/api/gatherings/{gid}/start")
def start_gathering(gid: int, _: str = Depends(require("host"))):
    with db.session() as c:
        g = _one(c, gid)
        if g["status"] != "approved":
            raise HTTPException(409, "Only approved gatherings can start")
        if g["started_at"]:
            raise HTTPException(409, "Already started")
        c.execute("UPDATE gatherings SET started_at=datetime('now','localtime') WHERE id=?", (gid,))
        g = _one(c, gid)
    push.notify("wife", f"{g['title']} has started", g["location"] or "Enjoy the evening.", "/", CONTACT)
    return g


@app.post("/api/gatherings/{gid}/end")
def end_gathering(gid: int, _: str = Depends(require("host"))):
    with db.session() as c:
        g = _one(c, gid)
        if not g["started_at"] or g["ended_at"]:
            raise HTTPException(409, "Not in progress")
        c.execute("UPDATE gatherings SET ended_at=datetime('now','localtime') WHERE id=?", (gid,))
        g = _one(c, gid)
    n = g["beers"]["total"]
    push.notify("wife", f"{g['title']} is wrapping up", f"{n} beer{'s' if n != 1 else ''} logged. Heading home.", "/", CONTACT)
    return g


class BeerIn(BaseModel):
    beer_type_id: Optional[int] = None
    qty: int = Field(1, ge=1, le=24)


@app.post("/api/gatherings/{gid}/beers", status_code=201)
def add_beer(gid: int, body: BeerIn, _: str = Depends(require("host"))):
    with db.session() as c:
        g = _one(c, gid)
        if not g["started_at"] or g["ended_at"]:
            raise HTTPException(409, "Start the gathering first (and don't log after it ends)")
        c.execute("INSERT INTO beer_log(gathering_id, beer_type_id, qty) VALUES (?,?,?)", (gid, body.beer_type_id, body.qty))
        g = _one(c, gid)
    limit = g["drink_limit"]
    if limit is not None and g["beers"]["total"] == limit:
        push.notify("wife", "Beer limit reached", f"{g['title']}: {limit} beers logged", "/", CONTACT)
    return g


@app.delete("/api/beers/{bid}")
def undo_beer(bid: int, _: str = Depends(require("host"))):
    with db.session() as c:
        row = c.execute("SELECT gathering_id FROM beer_log WHERE id=?", (bid,)).fetchone()
        if not row:
            raise HTTPException(404, "Entry not found")
        c.execute("DELETE FROM beer_log WHERE id=?", (bid,))
        return _one(c, row["gathering_id"])


# ---------- groups ----------

class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = Field("#f59e0b", pattern=r"^#[0-9a-fA-F]{6}$")
    target_days: Optional[int] = Field(None, ge=1, le=365)
    members: Optional[PeopleList] = Field(None, max_length=50)  # None keeps the current members


class RhythmIn(BaseModel):
    target_days: Optional[int] = Field(None, ge=1, le=365)


@app.get("/api/groups")
def list_groups(_: str = Depends(require())):
    with db.session() as c:
        return _groups(c)


@app.post("/api/groups", status_code=201)
def create_group(body: GroupIn, _: str = Depends(require("host"))):
    with db.session() as c:
        try:
            cur = c.execute("INSERT INTO groups(name, color, target_days) VALUES (?,?,?)", (body.name, body.color, body.target_days))
        except Exception:
            raise HTTPException(409, "Group name already exists")
        db.set_people(c, "group_members", "group_id", cur.lastrowid, _clean_names(body.members or []))
        return _group(c, cur.lastrowid)


@app.patch("/api/groups/{grp}")
def update_group(grp: int, body: GroupIn, _: str = Depends(require("host"))):
    with db.session() as c:
        _group(c, grp)
        try:
            c.execute("UPDATE groups SET name=?, color=?, target_days=? WHERE id=?", (body.name, body.color, body.target_days, grp))
        except Exception:
            raise HTTPException(409, "Group name already exists")
        if body.members is not None:
            db.set_people(c, "group_members", "group_id", grp, _clean_names(body.members))
        return _group(c, grp)


@app.put("/api/groups/{grp}/rhythm")
def set_rhythm(grp: int, body: RhythmIn, role: str = Depends(require())):
    """How often a group should meet. Both people may change this."""
    with db.session() as c:
        old = _group(c, grp)
        c.execute("UPDATE groups SET target_days=? WHERE id=?", (body.target_days, grp))
        g = _group(c, grp)
    if role == "wife" and old["target_days"] != body.target_days:
        every = f"every {body.target_days} days" if body.target_days else "no goal"
        push.notify("host", f"{g['name']}: {every}", "She changed how often this group meets.", "/", CONTACT)
    return g


# ---------- people ----------

@app.get("/api/people")
def list_people(_: str = Depends(require())):
    with db.session() as c:
        return [r["name"] for r in c.execute("SELECT name FROM people ORDER BY name COLLATE NOCASE")]


@app.delete("/api/groups/{grp}")
def delete_group(grp: int, _: str = Depends(require("host"))):
    with db.session() as c:
        c.execute("DELETE FROM groups WHERE id=?", (grp,))
    return {"ok": True}


# ---------- beer catalog ----------

class BeerTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    abv: Optional[float] = Field(None, ge=0, le=20)
    size_ml: Optional[int] = Field(None, ge=1, le=2000)


@app.get("/api/beer-types")
def list_beer_types(_: str = Depends(require())):
    with db.session() as c:
        return [dict(r) for r in c.execute("SELECT * FROM beer_types WHERE active=1 ORDER BY name")]


@app.post("/api/beer-types", status_code=201)
def create_beer_type(body: BeerTypeIn, _: str = Depends(require("host"))):
    with db.session() as c:
        try:
            cur = c.execute("INSERT INTO beer_types(name, abv, size_ml) VALUES (?,?,?)", (body.name, body.abv, body.size_ml))
        except Exception:
            # Re-adding a retired beer brings it back.
            c.execute("UPDATE beer_types SET active=1, abv=?, size_ml=? WHERE name=?", (body.abv, body.size_ml, body.name))
            return dict(c.execute("SELECT * FROM beer_types WHERE name=?", (body.name,)).fetchone())
        return dict(c.execute("SELECT * FROM beer_types WHERE id=?", (cur.lastrowid,)).fetchone())


@app.delete("/api/beer-types/{bid}")
def retire_beer_type(bid: int, _: str = Depends(require("host"))):
    # Soft-delete so historical logs keep their names.
    with db.session() as c:
        c.execute("UPDATE beer_types SET active=0 WHERE id=?", (bid,))
    return {"ok": True}


# ---------- stats ----------

@app.get("/api/stats")
def stats(_: str = Depends(require())):
    now = datetime.now()
    with db.session() as c:
        groups = _groups(c)
        all_g = _gatherings(c)
        held = [g for g in all_g if g["status"] == "approved" and (g["started_at"] or datetime.strptime(g["start"], FMT) <= now)]
    out = []
    for grp in groups:
        mine = sorted(datetime.strptime(g["start"], FMT) for g in held if g["group_id"] == grp["id"])
        last = mine[-1] if mine else None
        gaps = [(b - a).total_seconds() / 86400 for a, b in zip(mine, mine[1:])]
        days_since = max(0, (now - last).days) if last else None
        target = grp["target_days"]
        out.append(
            {
                **grp,
                "meetings": len(mine),
                "last": last.strftime(FMT) if last else None,
                "days_since": days_since,
                "avg_gap_days": round(sum(gaps) / len(gaps), 1) if gaps else None,
                "last_90d": sum(1 for d in mine if (now - d).days <= 90),
                "overdue": bool(target and (days_since is None or days_since > target)),
                "beers": sum(g["beers"]["total"] for g in held if g["group_id"] == grp["id"]),
            }
        )
    seen: dict[str, list[datetime]] = {}
    for g in held:
        for name in g["people"]:
            seen.setdefault(name, []).append(datetime.strptime(g["start"], FMT))
    people = sorted(
        (
            {
                "name": name,
                "meetings": len(ds),
                "last_90d": sum(1 for d in ds if (now - d).days <= 90),
                "last": max(ds).strftime(FMT),
                "days_since": max(0, (now - max(ds)).days),
            }
            for name, ds in seen.items()
        ),
        key=lambda p: (-p["meetings"], p["name"].lower()),
    )
    month = now.strftime("%Y-%m")
    this_month = [g for g in all_g if g["start"].startswith(month)]
    answered = [g for g in all_g if g["status"] in ("approved", "declined")]
    return {
        "groups": out,
        "people": people,
        "month": {
            "gatherings": sum(1 for g in this_month if g["status"] == "approved"),
            "beers": sum(g["beers"]["total"] for g in this_month),
            "requests": len(this_month),
        },
        "approval_rate": round(100 * sum(1 for g in answered if g["status"] == "approved") / len(answered)) if answered else None,
        "total_beers": sum(g["beers"]["total"] for g in all_g),
    }


# ---------- push ----------

@app.get("/api/push/key")
def push_key(_: str = Depends(require())):
    return {"key": push.vapid_keys()[1]}


class Sub(BaseModel):
    subscription: dict


@app.post("/api/push/subscribe")
def push_subscribe(body: Sub, role: str = Depends(require())):
    endpoint = body.subscription.get("endpoint")
    if not isinstance(endpoint, str) or not push.is_allowed_endpoint(endpoint):
        raise HTTPException(422, "Unsupported push endpoint")
    with db.session() as c:
        owner = c.execute("SELECT role FROM push_subs WHERE endpoint=?", (endpoint,)).fetchone()
        if owner and owner["role"] != role:
            raise HTTPException(409, "This device is already registered for the other person")
        c.execute(
            "INSERT INTO push_subs(endpoint, role, data) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET data=excluded.data",
            (endpoint, role, json.dumps(body.subscription)),
        )
    return {"ok": True}


@app.post("/api/push/test")
def push_test(role: str = Depends(require())):
    push.notify(role, "Notifications are on", "You will be notified on this device.", "/", CONTACT)
    return {"ok": True}


# ---------- iCal feed (for the wife's own calendar app) ----------

def _ics_escape(s: str) -> str:
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = "".join(ch for ch in s if ch == "\n" or ch >= " " and ch != "\x7f")  # no control chars: they could inject iCal lines
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


@app.get("/api/ics-url")
def ics_url(_: str = Depends(require())):
    with db.session() as c:
        return {"path": f"/calendar.ics?key={db.ensure_secret(c, 'ics_key')}"}


@app.get("/calendar.ics")
def ics(key: str = ""):
    with db.session() as c:
        good = db.ensure_secret(c, "ics_key")
        rows = [g for g in _gatherings(c) if g["status"] == "approved"]
    if not hmac.compare_digest(key, good):
        raise HTTPException(403, "Bad key")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Evenings//EN", "X-WR-CALNAME:Evenings"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    for g in rows:
        s = datetime.strptime(g["start"], FMT)
        e = datetime.strptime(g["end"], FMT) if g["end"] else s + timedelta(hours=3)
        desc = " | ".join(x for x in (g["conditions"] and f"Conditions: {g['conditions']}", g["people"] and f"With: {', '.join(g['people'])}", g["note"], g["map_url"] and f"Map: {g['map_url']}") if x)
        lines += [
            "BEGIN:VEVENT",
            f"UID:evening-{g['id']}@evenings",
            f"DTSTAMP:{stamp}",
            f"DTSTART:{s.strftime('%Y%m%dT%H%M%S')}",
            f"DTEND:{e.strftime('%Y%m%dT%H%M%S')}",
            f"SUMMARY:{_ics_escape(g['title'])}",
            f"LOCATION:{_ics_escape(g['location'])}",
            f"DESCRIPTION:{_ics_escape(desc)}",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return PlainTextResponse("\r\n".join(lines) + "\r\n", media_type="text/calendar")


# ---------- static / PWA ----------

@app.get("/sw.js")
def sw():
    return FileResponse(STATIC / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


class _Static(StaticFiles):
    # Revalidate on every load (cheap 304s via ETag) so a deploy never mixes old and new JS modules.
    async def get_response(self, path, scope):
        r = await super().get_response(path, scope)
        r.headers["Cache-Control"] = "no-cache"
        return r


app.mount("/static", _Static(directory=STATIC), name="static")
