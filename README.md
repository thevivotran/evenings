# Evenings

Tiny calendar for friend gatherings, built so the wife can check it.

- **Host** files a request; **wife** approves / declines (with note, conditions, beer limit) or ignores it.
- During an approved gathering the host taps "start", logs beers by type, then "heading home".
- **Groups** track how often each crew meets, with an "overdue" nudge against a per-group goal.
- Push notifications (new request, answer, started, limit reached, heading home) and a `.ics` feed for her own calendar app.

## Run locally

```bash
uv venv .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
HOST_PIN=1234 WIFE_PIN=5678 .venv/bin/python -m uvicorn app.main:app --port 8088
.venv/bin/python -m pytest -q
```

Frontend: no build step. `app/static/js/` holds native ES modules: `main.js` is the shell with a `TABS` registry (add a screen = add a view in `js/views/` + one entry), `ui.js` the shared components (bottom sheet, confirm, toast, buttons, fields, chips, stepper), and `style.css` a token-based design system (light/dark via tokens, `@layer` ordered).

Data lives in `data/evenings.db` (override with `DB_PATH`). `TZ` should match your timezone: times are stored as local wall-clock.

## Security

- `HOST_PIN` and `WIFE_PIN` are required (at least 4 characters); the app refuses to start without them.
- 5 wrong PINs for a role locks that role's sign-in for 15 minutes (client headers are not trusted), and the host gets a push alert. Sessions last 180 days, so lockouts rarely matter day to day.
- Push subscriptions are only accepted from real push services (FCM, Mozilla, Apple, Windows) over HTTPS.
- Meant to be reached over Tailscale only; there is no public exposure.

## Deploy (homelab, Flux + Tailscale)

1. Push to GitHub; `.github/workflows/image.yaml` publishes `ghcr.io/thevivotran/evenings:main-<ts>-<sha>`.
2. Copy `deploy/` to `homelab/apps/evenings/` and add `evenings` to `apps/kustomization.yaml`.
3. Create `evenings-secrets.sops.yaml` (Secret `evenings-secrets` in namespace `evenings` with `HOST_PIN` and `WIFE_PIN`) and encrypt it with sops.
4. Update the first image tag in `helmrelease.yaml` to a real published tag (Flux image automation keeps it fresh afterwards).
5. Reach it at `https://evenings.<tailnet>.ts.net`. Your wife's phone must be on the tailnet (invite her, or share the device).

## iPhone notifications

Web push on iOS only works for a web app on the Home Screen (iOS 16.4+):
Safari → Share → **Add to Home Screen** → open it from the Home Screen → Settings → **Enable on this device**.
Both of you do this once, each logging in with your own PIN. The push itself travels via Apple's servers, so the phones and the pod need normal internet access even though the app is tailnet-only.

## Notes

- Back up by copying `evenings.db` (the PVC; add it to your restic backup like the other apps if you care).
- VAPID keys and the session/ICS secrets are generated on first start and stored in the DB, so restoring the DB preserves push subscriptions.
