# Recovery Radar

Wildfire impact/recovery dashboard. Plaskett Fire is the current test case.

Live: https://recovery-radar.alexanderjamesklein.workers.dev

## Stack

- React + TypeScript + Vite
- Cloudflare Worker + Static Assets
- Cloudflare KV for recovery state
- MapLibre + OpenFreeMap
- WFIGS/NIFC for current perimeter
- Monterey County GIS for building footprints
- Shovels for permit/recovery data

## Data flow

```text
WFIGS perimeter -----> map / acreage / perimeter time
        |
        +-----> Monterey County GIS -----> building intersections
        |
        +-----> cached Shovels sites -----> inside / <=5 km / outside

Cloudflare cron -----> Shovels incremental recovery query -----> KV
```

Public traffic never calls Shovels directly.

## Rules

- perimeter overlap = exposure, not confirmed damage
- permit rows != projects
- no returned Shovels records = no observed records for that query window, not proof of no activity
- Shovels credit reserve: 100
- scheduled recovery max: 5 returned records/run
- state-wide Shovels queries blocked by default in the local ingest CLI

## Current Plaskett scope

- incident: Plaskett Fire
- Shovels geo: `93920`
- baseline: `2025-08-26` through `2026-08-25`
- recovery start: `2026-08-26`
- manually checked through `2026-09-01`: 0 recovery permits returned
- scheduled sync: daily at `15:15 UTC`

The baseline sample is intentionally small. It is used for site/trade/permit timing examples, not market sizing.

## Local

```bash
npm install
cp .dev.vars.example .dev.vars
```

`.dev.vars`:

```text
SHOVELS_API_KEY=...
```

Run:

```bash
npm run dev
```

Build/check:

```bash
npm run check
```

## API

```text
GET /api/health
GET /api/fire/perimeter?name=Plaskett
GET /api/impact/buildings?name=Plaskett
GET /api/incidents/plaskett-2026
```

`/api/incidents/plaskett-2026` merges the committed incident snapshot with KV recovery state when available.

## Shovels ingest

Budget check only:

```bash
npm run ingest:shovels -- \
  --slug plaskett-2026 \
  --dataset recovery \
  --geo-id 93920 \
  --from 2026-08-26 \
  --to 2026-09-01 \
  --dry-run
```

Small baseline pull:

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

Snapshots go to:

```text
public/data/incidents/<slug>.json
```

Published Shovels data is sanitized. No street address/raw response dump.

## Deploy

First deploy / secret upload:

```bash
npm run deploy:first
```

Normal deploy:

```bash
npm run deploy
```

Cloudflare config includes:

```text
Worker: recovery-radar
KV: RECOVERY_STATE
Cron: 15 15 * * *
Secret: SHOVELS_API_KEY
```
