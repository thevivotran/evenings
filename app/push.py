import base64
import json
import logging
import threading
from urllib.parse import urlparse

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid
from pywebpush import WebPushException, webpush

from . import db

log = logging.getLogger("push")


# Only real browser push services are ever contacted, so a forged subscription
# can't turn the server into a request proxy for internal addresses.
PUSH_HOSTS = ("fcm.googleapis.com", "updates.push.services.mozilla.com")
PUSH_SUFFIXES = (".push.apple.com", ".notify.windows.com", ".push.services.mozilla.com")


def is_allowed_endpoint(endpoint: str) -> bool:
    try:
        u = urlparse(endpoint)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and u.port in (None, 443) and not u.username and (host in PUSH_HOSTS or host.endswith(PUSH_SUFFIXES))


def vapid_keys() -> tuple[str, str]:
    """Return (private_pem, public_b64url), generating and persisting on first use."""
    with db.session() as c:
        priv = db.get_setting(c, "vapid_private")
        pub = db.get_setting(c, "vapid_public")
        if priv and pub:
            return priv, pub
        v = Vapid()
        v.generate_keys()
        priv = v.private_pem().decode()
        raw = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        pub = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
        db.set_setting(c, "vapid_private", priv)
        db.set_setting(c, "vapid_public", pub)
        return priv, pub


def _send_all(role: str, payload: dict, contact: str) -> None:
    priv_pem, _ = vapid_keys()
    vapid = Vapid.from_pem(priv_pem.encode())
    with db.session() as c:
        subs = c.execute("SELECT endpoint, data FROM push_subs WHERE role=?", (role,)).fetchall()
    dead = []
    for s in subs:
        try:
            webpush(
                subscription_info=json.loads(s["data"]),
                data=json.dumps(payload),
                vapid_private_key=vapid,
                vapid_claims={"sub": contact},
                ttl=3600,
            )
        except WebPushException as e:
            status = getattr(e.response, "status_code", None)
            log.warning("push to %s failed: %s", s["endpoint"][:40], e)
            if status in (404, 410):
                dead.append(s["endpoint"])
        except Exception as e:  # network down, bad key, etc. must never break a request
            log.warning("push error: %s", e)
    if dead:
        with db.session() as c:
            c.executemany("DELETE FROM push_subs WHERE endpoint=?", [(d,) for d in dead])


def notify(role: str, title: str, body: str, url: str = "/", contact: str = "mailto:admin@example.com") -> None:
    """Fire-and-forget push to every device registered for a role."""
    threading.Thread(
        target=_send_all, args=(role, {"title": title, "body": body, "url": url}, contact), daemon=True
    ).start()
