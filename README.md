# Recovery Radar

Turn incident geometry into built-world intelligence.

Recovery Radar combines disaster/event boundaries with permit, property, jurisdiction, and contractor intelligence. California wildfire recovery is the first deployment target, using CAL FIRE incident context, WFIGS/NIFC perimeter geometry, public GIS, and selectively ingested Shovels data.

## Architecture

```text
WFIGS perimeter
      |
      +----------------------+
      |                      |
      v                      v
public structure GIS   controlled Shovels ingest
      |                      |
      v                      v
free impact signal     sanitized cached snapshot
      |                      |
      +----------+-----------+
                 |
                 v
       Impact / Recovery / Capacity
```

**Shovels is not a request-time backend.** Public traffic never calls Shovels and cannot consume API credits. Shovels enrichment is an explicit local ingestion step that writes sanitized incident snapshots into `public/data/incidents/`.

The Impact surface is intentionally free at runtime. For the Plaskett prototype, the Worker intersects the freshest WFIGS perimeter with Monterey County's public Building Footprints layer. The county footprints are derived from 2010 LiDAR, so their count is labeled a **mapped-structure exposure proxy**, never a damage count.

## MVP

- React + TypeScript + Vite
- Cloudflare Worker + Static Assets
- MapLibre + OpenFreeMap dark basemap
- WFIGS/NIFC live perimeter adapter
- Monterey County building-footprint exposure adapter
- Credit-governed Shovels ingestion CLI
- Cached/sanitized public incident snapshots
- Impact, Recovery, and Capacity views
- Evidence-first metrics
- No database or authentication in v0

## Design principles

1. **Incident-agnostic core.** Wildfire is the first adapter, not the architecture.
2. **Exposure is not damage.** Geometry overlap is reported as exposure unless authoritative damage data confirms destruction.
3. **Evidence travels with the number.** Derived metrics retain their inputs, source, vintage, and confidence/coverage information.
4. **Credits are a hard budget.** Expensive commercial data is ingested deliberately, sanitized, cached, and reused.
5. **Use free public evidence first.** Commercial enrichment should add decision value, not duplicate public geometry.
6. **One application, many incidents.** Adding an incident creates a route/data manifest, not a deployment.

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

Run the app:

```bash
npm run dev
```

Useful free endpoints:

```text
GET /api/health
GET /api/fire/perimeter?name=Plaskett
GET /api/impact/buildings?name=Plaskett
GET /api/incidents/plaskett-2026
```

`/api/impact/buildings` performs a server-side spatial intersection between the live WFIGS polygon and Monterey County building footprints and is cached for one hour.

## Credit-safe Shovels ingestion

Shovels accepts a state code, ZIP code, or Shovels address/city/county/jurisdiction geolocation ID as `geo_id`. Prefer the narrowest useful geography. The CLI refuses a two-letter state code by default so a typo cannot spend credits on an arbitrary statewide sample.

For the Plaskett Fire, ZIP **93920** is the initial Big Sur/south-coast geography.

Check the budget and arguments without consuming permit records:

```bash
npm run ingest:shovels -- \
  --slug plaskett-2026 \
  --dataset recovery \
  --geo-id 93920 \
  --from 2026-08-26 \
  --to 2026-09-01 \
  --dry-run
```

Use `--probe` when deciding whether a window deserves a larger spend. Probe mode asks for one record with `include_count=true`, letting us learn the total match count at minimal cost when records exist.

```bash
npm run ingest:shovels -- \
  --slug plaskett-2026 \
  --dataset baseline \
  --geo-id 93920 \
  --from 2025-08-26 \
  --to 2026-08-25 \
  --probe
```

Keep baseline and recovery data separately inside the same incident artifact. A small baseline sample:

```bash
npm run ingest:shovels -- \
  --slug plaskett-2026 \
  --dataset baseline \
  --geo-id 93920 \
  --from 2025-08-26 \
  --to 2026-08-25 \
  --limit 10 \
  --reserve 100
```

Defaults are deliberately conservative: `25` records maximum per sync and `100` credits protected as reserve. The CLI checks `GET /v2/usage` first and refuses to query permits if it cannot verify the remaining balance.

The generated snapshot is written to:

```text
public/data/incidents/<slug>.json
```

Only a sanitized permit subset is published; street addresses and raw API responses are not written to the public artifact.

There is intentionally **no public Shovels proxy route**.

## Deploy

```bash
npm run deploy
```

The frontend, Worker API, live public-GIS queries, and cached incident snapshots deploy together to Cloudflare.
