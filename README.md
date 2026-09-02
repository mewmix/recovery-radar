# Recovery Radar

Turn incident geometry into built-world intelligence.

Recovery Radar is an incident-agnostic framework for combining disaster/event boundaries with permit, property, jurisdiction, and contractor intelligence. The first deployment target is California wildfire recovery using CAL FIRE incident data and the Shovels API.

## Product model

An incident adapter provides a normalized incident:

```ts
interface Incident {
  id: string;
  slug: string;
  name: string;
  type: "wildfire" | "flood" | "earthquake" | "tornado";
  startedAt: string;
  state: string;
  counties: string[];
  geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  source: {
    provider: string;
    id: string;
    url?: string;
  };
}
```

Everything downstream consumes that contract.

```text
CAL FIRE / future incident source
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
  Shovels       public GIS
 built world      context
     |             |
     +------+------+
            |
            v
  Impact / Recovery / Capacity
```

## MVP

- React + TypeScript + Vite
- Cloudflare Worker + Static Assets
- CAL FIRE adapter
- Shovels API adapter
- Local point-in-polygon filtering
- Impact, Recovery, and Capacity views
- Evidence-first metrics: expose source, calculation, coverage, and uncertainty
- No database or authentication in v0

## Design principles

1. **Incident-agnostic core.** Wildfire is the first adapter, not the architecture.
2. **Exposure is not damage.** Geometry overlap is reported as exposure unless authoritative damage data confirms destruction.
3. **Evidence travels with the number.** Derived metrics retain their inputs, source, and confidence/coverage information.
4. **Precompute what changes slowly.** Use live Shovels calls only for intentional drill-down and fresh recovery signals.
5. **One application, many incidents.** Adding an incident creates a route/data manifest, not a new deployment.

## Target command

```bash
pnpm incident:add --source calfire --id <incident-id>
```

The command should resolve the incident, normalize its geometry and metadata, derive the relevant Shovels geography, and emit an incident manifest consumable by the application.

## Environment

```bash
SHOVELS_API_KEY=
```

Never expose the Shovels API key to the browser.

## Status

Initial scaffold in progress.
