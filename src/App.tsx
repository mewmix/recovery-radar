import { useEffect, useMemo, useState } from "react";
import { IncidentMap, type FirePerimeter, type PermitMapPoint } from "./IncidentMap";
import { classifySiteExposure } from "./geo";

type Permit = {
  id?: string | null;
  status?: string | null;
  tags?: string[];
  jobValue?: number | null;
  contractorId?: string | null;
  dates?: { file?: string | null; issue?: string | null; start?: string | null; end?: string | null };
  location?: { lat?: number | null; lng?: number | null; city?: string | null; zip?: string | null; state?: string | null };
  geoIds?: { address_id?: string | null; city_id?: string | null; county_id?: string | null; jurisdiction_id?: string | null } | null;
};

type Dataset = {
  updatedAt?: string | null;
  query?: { geoId?: string; permitFrom?: string | null; permitTo?: string | null };
  permitCount?: number;
  totalMatches?: number | null;
  permits?: Permit[];
  sync?: {
    completeThrough?: string;
    pendingWindow?: unknown;
    lastRun?: { at?: string; status?: string; returned?: number; consumed?: number } | null;
    maxRecordsPerRun?: number;
    reserveCredits?: number;
  };
};

type IncidentArtifact = {
  slug?: string;
  updatedAt?: string;
  liveUpdatedAt?: string | null;
  shovels?: { datasets?: { baseline?: Dataset; recovery?: Dataset } };
};

type BuildingImpact = {
  incident?: { id?: string; name?: string; perimeterUpdatedAt?: string | null };
  exposure?: { mappedStructureCount?: number; source?: string; sourceUrl?: string; datasetVintage?: string; method?: string };
};

type Mode = "Impact" | "Recovery" | "Capacity";
type LoadState = "loading" | "ready" | "missing";

const INCIDENT = {
  slug: "plaskett-2026",
  name: "Plaskett Fire",
  county: "Monterey County, CA",
  startedAt: "2026-08-26",
  geoId: "93920",
};

const NEAR_THRESHOLD_KM = 5;

function formatWindow(dataset?: Dataset): string {
  const from = dataset?.query?.permitFrom;
  const to = dataset?.query?.permitTo;
  return from && to ? `${from} → ${to}` : "—";
}

function formatNumber(value?: number): string {
  return value == null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatKm(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} km`;
}

function formatMoney(value?: number): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function daysBetween(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function siteKey(permit: Permit): string {
  const addressId = permit.geoIds?.address_id;
  if (addressId) return `address:${addressId}`;
  const lat = permit.location?.lat;
  const lng = permit.location?.lng;
  if (typeof lat === "number" && typeof lng === "number") return `coord:${lat.toFixed(6)},${lng.toFixed(6)}`;
  return `permit:${permit.id ?? "unknown"}`;
}

function uniqueMappedSites(permits: Permit[]): PermitMapPoint[] {
  const sites = new Map<string, PermitMapPoint>();
  for (const permit of permits) {
    const lat = permit.location?.lat;
    const lng = permit.location?.lng;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const key = siteKey(permit);
    const existing = sites.get(key);
    if (existing) {
      existing.tags = Array.from(new Set([...(existing.tags ?? []), ...(permit.tags ?? [])]));
      existing.jobValue = Math.max(existing.jobValue ?? 0, permit.jobValue ?? 0);
      continue;
    }
    sites.set(key, {
      id: key,
      lat,
      lng,
      status: permit.status,
      tags: permit.tags ?? [],
      jobValue: permit.jobValue,
    });
  }
  return [...sites.values()];
}

export function App() {
  const [mode, setMode] = useState<Mode>("Impact");
  const [artifact, setArtifact] = useState<IncidentArtifact | null>(null);
  const [snapshotState, setSnapshotState] = useState<LoadState>("loading");
  const [perimeter, setPerimeter] = useState<FirePerimeter | null>(null);
  const [perimeterState, setPerimeterState] = useState<LoadState>("loading");
  const [buildingImpact, setBuildingImpact] = useState<BuildingImpact | null>(null);
  const [buildingState, setBuildingState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      fetch(`/api/incidents/${INCIDENT.slug}`).then(async (response) => {
        if (!response.ok) throw new Error("missing");
        return response.json() as Promise<IncidentArtifact>;
      }).then((data) => {
        if (!cancelled) { setArtifact(data); setSnapshotState("ready"); }
      }).catch(() => { if (!cancelled) setSnapshotState("missing"); }),
      fetch(`/api/fire/perimeter?name=${encodeURIComponent("Plaskett")}`).then(async (response) => {
        if (!response.ok) throw new Error("missing");
        return response.json() as Promise<FirePerimeter>;
      }).then((data) => {
        if (!cancelled) { setPerimeter(data); setPerimeterState("ready"); }
      }).catch(() => { if (!cancelled) setPerimeterState("missing"); }),
      fetch(`/api/impact/buildings?name=${encodeURIComponent("Plaskett")}`).then(async (response) => {
        if (!response.ok) throw new Error("missing");
        return response.json() as Promise<BuildingImpact>;
      }).then((data) => {
        if (!cancelled) { setBuildingImpact(data); setBuildingState("ready"); }
      }).catch(() => { if (!cancelled) setBuildingState("missing"); }),
    ]);

    return () => { cancelled = true; };
  }, []);

  const baseline = artifact?.shovels?.datasets?.baseline;
  const recovery = artifact?.shovels?.datasets?.recovery;
  const baselinePermits = baseline?.permits ?? [];
  const recoveryCount = recovery?.permitCount;
  const baselineCount = baseline?.permitCount;
  const acres = perimeter?.acres;
  const containment = perimeter?.containmentPct;
  const mappedStructures = buildingImpact?.exposure?.mappedStructureCount;

  const baselineSummary = useMemo(() => {
    const siteKeys = new Set(baselinePermits.map(siteKey));
    const rawMappedSites = uniqueMappedSites(baselinePermits);
    const mappedSites = perimeter
      ? rawMappedSites.map((site) => ({ ...site, ...classifySiteExposure(site.lng, site.lat, perimeter.geometry, NEAR_THRESHOLD_KM) }))
      : rawMappedSites;
    const statedValues = baselinePermits.map((permit) => permit.jobValue ?? 0).filter((value) => value > 0);
    const statedValue = statedValues.reduce((sum, value) => sum + value, 0);
    const largestValue = statedValues.length ? Math.max(...statedValues) : 0;
    const approvalDays = baselinePermits.map((permit) => daysBetween(permit.dates?.file, permit.dates?.issue)).filter((value): value is number => value != null);
    const contractors = new Set(baselinePermits.map((permit) => permit.contractorId).filter(Boolean));
    const tagCounts = new Map<string, number>();
    for (const permit of baselinePermits) for (const tag of permit.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    const dominantTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const insideSites = mappedSites.filter((site) => site.exposure === "inside");
    const nearSites = mappedSites.filter((site) => site.exposure === "near");
    const outsideSites = mappedSites.filter((site) => site.exposure === "outside");
    const distances = mappedSites.map((site) => site.distanceKm).filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    return {
      distinctSites: siteKeys.size,
      mappedSites,
      statedValue,
      statedValueRecords: statedValues.length,
      largestValueShare: statedValue > 0 ? largestValue / statedValue : null,
      medianApprovalDays: median(approvalDays),
      approvalSampleSize: approvalDays.length,
      knownContractors: contractors.size,
      dominantTags,
      insideSites: insideSites.length,
      nearSites: nearSites.length,
      outsideSites: outsideSites.length,
      nearestDistanceKm: distances.length ? Math.min(...distances) : null,
    };
  }, [baselinePermits, perimeter]);

  const metrics = useMemo(() => {
    if (mode === "Recovery") {
      return [
        { label: "Recovery permits", value: recoveryCount == null ? "—" : String(recoveryCount), note: formatWindow(recovery) },
        { label: "Complete through", value: recovery?.sync?.completeThrough ?? recovery?.query?.permitTo ?? "—", note: recovery?.sync ? "Scheduled incremental sync" : "Cached snapshot" },
        { label: "Last check", value: formatDateTime(recovery?.sync?.lastRun?.at ?? recovery?.updatedAt), note: recovery?.sync?.lastRun?.status?.replaceAll("_", " ").toUpperCase() ?? "—" },
        { label: "Sync cap", value: recovery?.sync?.maxRecordsPerRun == null ? "—" : `${recovery.sync.maxRecordsPerRun}/run`, note: recovery?.sync?.reserveCredits == null ? "Credit guard active" : `${recovery.sync.reserveCredits} credits reserved` },
      ];
    }

    if (mode === "Capacity") {
      const dominant = baselineSummary.dominantTags[0];
      return [
        { label: "Baseline sites", value: baselineCount == null ? "—" : String(baselineSummary.distinctSites), note: `${baselineCount ?? 0} sampled permit rows` },
        { label: "Median file → issue", value: baselineSummary.medianApprovalDays == null ? "—" : `${formatNumber(baselineSummary.medianApprovalDays)}d`, note: `n=${baselineSummary.approvalSampleSize}` },
        { label: "Known contractors", value: baselineCount == null ? "—" : String(baselineSummary.knownContractors), note: "Cached sample" },
        { label: "Top trade", value: dominant ? dominant[0].replaceAll("_", " ").toUpperCase() : "—", note: dominant ? `${dominant[1]} rows` : "—" },
      ];
    }

    return [
      { label: "Mapped structures", value: mappedStructures == null ? "—" : formatNumber(mappedStructures), note: buildingState === "ready" ? "Footprints intersect perimeter" : "Loading county GIS" },
      { label: "Sites inside", value: perimeterState !== "ready" ? "—" : String(baselineSummary.insideSites), note: `${baselineSummary.mappedSites.length} sampled sites mapped` },
      { label: `Sites ≤${NEAR_THRESHOLD_KM} km`, value: perimeterState !== "ready" ? "—" : String(baselineSummary.nearSites), note: "Excludes inside" },
      { label: "Nearest site", value: perimeterState !== "ready" ? "—" : formatKm(baselineSummary.nearestDistanceKm), note: baselineSummary.insideSites > 0 ? "Inside perimeter" : "To perimeter boundary" },
    ];
  }, [baselineCount, baselineSummary, buildingState, mappedStructures, mode, perimeterState, recovery, recoveryCount]);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="eyebrow">RECOVERY RADAR</span>
          <h1>{INCIDENT.name}</h1>
          <span className="subhead">{INCIDENT.county} · started {formatDate(INCIDENT.startedAt)}</span>
        </div>
        <div className="header-status">
          <span className="status"><i /> LIVE</span>
          <span>WFIGS + Monterey GIS + Shovels</span>
        </div>
      </header>

      <section className="dashboard-grid">
        <article className="map-stage">
          <IncidentMap perimeter={perimeter} state={perimeterState} baselinePermits={baselineSummary.mappedSites} />
          <div className="map-legend">
            <span><i className="legend-dot inside" />Inside</span>
            <span><i className="legend-dot near" />≤ {NEAR_THRESHOLD_KM} km</span>
            <span><i className="legend-dot outside" />Outside</span>
          </div>
        </article>

        <aside className="incident-card">
          <span className="eyebrow">INCIDENT</span>
          <dl className="incident-stats">
            <div><dt>Perimeter</dt><dd>{acres == null ? "—" : `${formatNumber(acres)} ac`}</dd></div>
            <div><dt>Containment</dt><dd>{containment == null ? "—" : `${formatNumber(containment)}%`}</dd></div>
            <div><dt>Structures</dt><dd>{formatNumber(mappedStructures)}</dd></div>
            <div><dt>Perimeter updated</dt><dd>{formatDateTime(perimeter?.perimeterUpdatedAt)}</dd></div>
          </dl>
          <div className="site-breakdown">
            <span className="eyebrow">SAMPLED PRE-FIRE SITES</span>
            <div className="breakdown-row"><span>Inside</span><strong>{baselineSummary.insideSites}</strong></div>
            <div className="breakdown-row"><span>Near</span><strong>{baselineSummary.nearSites}</strong></div>
            <div className="breakdown-row"><span>Outside</span><strong>{baselineSummary.outsideSites}</strong></div>
            <div className="breakdown-row"><span>Unmapped</span><strong>{Math.max(0, baselineSummary.distinctSites - baselineSummary.mappedSites.length)}</strong></div>
          </div>
        </aside>
      </section>

      <nav className="tabs" aria-label="Intelligence modes">
        {(["Impact", "Recovery", "Capacity"] as Mode[]).map((item) => (
          <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{item}</button>
        ))}
      </nav>

      <section className="metrics">
        {metrics.map((metric) => (
          <article key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.note}</small>
          </article>
        ))}
      </section>

      <section className="evidence-panel">
        <div>
          <span className="eyebrow">EVIDENCE</span>
          <strong>{mode}</strong>
        </div>
        <div className="evidence-facts">
          {mode === "Impact" ? (
            <>
              <span><b>Perimeter</b>WFIGS · {formatDateTime(perimeter?.perimeterUpdatedAt)}</span>
              <span><b>Structures</b>Monterey County · {buildingImpact?.exposure?.datasetVintage ?? "2010 LiDAR"}</span>
              <span><b>Site sample</b>{baselineSummary.insideSites} inside · {baselineSummary.nearSites} near · {baselineSummary.outsideSites} outside</span>
              <span><b>Method</b>Point-in-polygon + {NEAR_THRESHOLD_KM} km boundary distance</span>
            </>
          ) : mode === "Capacity" ? (
            <>
              <span><b>Window</b>{formatWindow(baseline)}</span>
              <span><b>Stated value</b>{formatMoney(baselineSummary.statedValue)} · {baselineSummary.statedValueRecords}/{baselineCount ?? 0} non-zero</span>
              <span><b>Largest value share</b>{baselineSummary.largestValueShare == null ? "—" : `${Math.round(baselineSummary.largestValueShare * 100)}%`}</span>
              <span><b>Sample</b>{baselineCount ?? "—"} rows · {baselineSummary.distinctSites} sites</span>
            </>
          ) : (
            <>
              <span><b>ZIP</b>{recovery?.query?.geoId ?? INCIDENT.geoId}</span>
              <span><b>Window</b>{formatWindow(recovery)}</span>
              <span><b>Observed</b>{recoveryCount ?? "—"} permits</span>
              <span><b>Sync</b>{recovery?.sync?.lastRun?.status?.replaceAll("_", " ") ?? (snapshotState === "ready" ? "cached" : "loading")}</span>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
