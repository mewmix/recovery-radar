# Recovery Radar

Turn incident geometry into built-world intelligence.

Recovery Radar combines disaster/event boundaries with permit, property, jurisdiction, and contractor intelligence. California wildfire recovery is the first deployment target, using CAL FIRE incident context, WFIGS/NIFC perimeter geometry, and selectively ingested Shovels data.

## Architecture

```text
CAL FIRE context + WFIGS perimeter
                |
                v
          Incident adapter
                |
                v
          geometry + date
                |
         +------+------+
         |             |
         v             v
  controlled ingest   public GIS
      (Shovels)        context
         |             |
         v             |
 sanitized snapshot   |
         |             |
         +------+------+
                |
                v
      Impact / Recovery / Capacity
```

**Shovels is not a request-time backend.** Public traffic never calls Shovels and cannot consume API credits. Shovels enrichment is an explicit local ingestion step that writes sanitized incident snapshots into `public/data/incidents/`.

## MVP

- React + TypeScript + Vite
- Cloudflare Worker + Static Assets
- WFIGS/NIFC live perimeter adapter
- CAL FIRE incident/context adapter (next)
- Credit-governed Shovels ingestion CLI
- Cached/sanitized public incident snapshots
- Local point-in-polygon filtering
- Impact, Recovery, and Capacity views
- Evidence-first metrics
- No database or authentication in v0

## Design principles

1. **Incident-agnostic core.** Wildfire is the first adapter, not the architecture.
2. **Exposure is not damage.** Geometry overlap is reported as exposure unless authoritative damage data confirms destruction.
3. **Evidence travels with the number.** Derived metrics retain their inputs, source, and confidence/coverage information.
4. **Credits are a hard budget.** Expensive commercial data is ingested deliberately, sanitized, cached, and reused.
5. **One application, many incidents.** Adding an incident creates a route/data manifest, not a deployment.

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars
```

Put the real key in `.dev.vars`:

```text
SHOVELS_API_KEY=your_key_here
```

`.dev.vars` is gitignored and the key is not required in Cloudflare for v0.

## Credit-safe Shovels ingestion

Shovels accepts a state code, ZIP code, or Shovels address/city/county/jurisdiction geolocation ID as `geo_id`. Prefer the narrowest useful geography. The CLI refuses a two-letter state code by default so a typo cannot spend credits on an arbitrary statewide sample.

For the Plaskett Fire, ZIP **93920** covers the Big Sur/Gorda/Lucia/Pacific Valley area and is the initial candidate geography.

Check the budget and arguments without consuming permit records:

```bash
npm run ingest:shovels -- \
  --slug plaskett-2026 \
  --geo-id 93920 \
  --from 2026-08-26 \
  --to 2026-09-01 \
  --dry-run
```

For the first actual Plaskett enrichment, keep the sample intentionally small:

```bash
npm run ingest:shovels -- \
  --slug plaskett-2026 \
  --geo-id 93920 \
  --from 2026-08-26 \
  --to 2026-09-01 \
  --limit 10 \
  --reserve 100
```

A state-level query can still be run only when explicitly intended:

```bash
npm run ingest:shovels -- \
  --slug california-sample \
  --geo-id CA \
  --from 2026-08-26 \
  --to 2026-09-01 \
  --limit 10 \
  --allow-broad-geo
```

Defaults are deliberately conservative: `25` records maximum per sync and `100` credits protected as reserve. The CLI checks `GET /v2/usage` first and refuses to query permits if it cannot verify the remaining balance.

The generated snapshot is written to:

```text
public/data/incidents/<slug>.json
```

Only a sanitized permit subset is published; street addresses and raw API responses are not written to the public artifact.

## Public API routes

```text
GET /api/health
GET /api/fire/perimeter?name=Plaskett
GET /api/incidents/<slug>
```

There is intentionally **no public Shovels proxy route**.

## Deploy

```bash
npm run deploy
```

The frontend, Worker API, and cached incident snapshots deploy together to Cloudflare.
