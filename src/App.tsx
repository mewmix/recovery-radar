import { useEffect, useMemo, useState } from "react";
import { IncidentMap, type FirePerimeter, type PermitMapPoint } from "./IncidentMap";

type Permit = {
  id?: string | null;
  status?: string | null;
  tags?: string[];
  jobValue?: number | null;
  contractorId?: string | null;
  dates?: {
    file?: string | null;
    issue?: string | null;
    start?: string | null;
    end?: string | null;
  };
  location?: {
    lat?: number | null;
    lng?: number | null;
    city?: string | null;
    zip?: string | null;
    state?: string | null;
  };
  geoIds?: {
    address_id?: string | null;
    city_id?: string | null;
    county_id?: string | null;
    jurisdiction_id?: string | null;
  } | null;
};

type Dataset = {
  updatedAt?: string;
  query?: {
    geoId?: string;
    permitFrom?: string;
    permitTo?: string;
  };
  permitCount?: number;
  totalMatches?: number | null;
  permits?: Permit[];
};

type IncidentArtifact = {
  slug?: string;
  updatedAt?: string;
  shovels?: {
    datasets?: {
      baseline?: Dataset;
      recovery?: Dataset;
    };
  };
};

type BuildingImpact = {
  incident?: {
    id?: string;
    name?: string;
    perimeterUpdatedAt?: string | null;
  };
  exposure?: {
    mappedStructureCount?: number;
    source?: string;
    sourceUrl?: string;
    datasetVintage?: string;
    method?: string;
  };
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

function formatWindow(dataset?: Dataset): string {
  const from = dataset?.query?.permitFrom;
  const to = dataset?.query?.permitTo;
  return from && to ? `${from} → ${to}` : "Awaiting cached dataset";
}

function formatNumber(value?: number): string {
  return value == null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
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
  if (!value) return INCIDENT.startedAt;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return INCIDENT.startedAt;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
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
  return `permit:${permit.id ?? Math.random()}`;
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

    fetch(`/api/incidents/${INCIDENT.slug}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("missing");
        return response.json() as Promise<IncidentArtifact>;
      })
      .then((data) => {
        if (cancelled) return;
        setArtifact(data);
        setSnapshotState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshotState("missing");
      });

    fetch(`/api/fire/perimeter?name=${encodeURIComponent("Plaskett")}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("missing");
        return response.json() as Promise<FirePerimeter>;
      })
      .then((data) => {
        if (cancelled) return;
        setPerimeter(data);
        setPerimeterState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPerimeterState("missing");
      });

    fetch(`/api/impact/buildings?name=${encodeURIComponent("Plaskett")}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("missing");
        return response.json() as Promise<BuildingImpact>;
      })
      .then((data) => {
        if (cancelled) return;
        setBuildingImpact(data);
        setBuildingState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setBuildingState("missing");
      });

    return () => { cancelled = true; };
  }, []);

  const baseline = artifact?.shovels?.datasets?.baseline;
  const recovery = artifact?.shovels?.datasets?.recovery;
  const baselinePermits = baseline?.permits ?? [];
  const recoveryCount = recovery?.permitCount;
  const baselineCount = baseline?.permitCount;
  const recoveryMatches = recovery?.totalMatches;
  const acres = perimeter?.acres;
  const containment = perimeter?.containmentPct;
  const mappedStructures = buildingImpact?.exposure?.mappedStructureCount;

  const baselineSummary = useMemo(() => {
    const siteKeys = new Set(baselinePermits.map(siteKey));
    const mappedSites = uniqueMappedSites(baselinePermits);
    const statedValues = baselinePermits.map((permit) => permit.jobValue ?? 0).filter((value) => value > 0);
    const statedValue = statedValues.reduce((sum, value) => sum + value, 0);
    const largestValue = statedValues.length ? Math.max(...statedValues) : 0;
    const approvalDays = baselinePermits
      .map((permit) => daysBetween(permit.dates?.file, permit.dates?.issue))
      .filter((value): value is number => value != null);
    const contractors = new Set(baselinePermits.map((permit) => permit.contractorId).filter(Boolean));
    const tagCounts = new Map<string, number>();
    for (const permit of baselinePermits) {
      for (const tag of permit.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    const dominantTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

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
    };
  }, [baselinePermits]);

  const recoveryLabel = recoveryCount === 0
    ? "No matching permits observed"
    : recoveryCount == null
      ? "Awaiting recovery snapshot"
      : `${recoveryCount} observed permit${recoveryCount === 1 ? "" : "s"}`;

  const metrics = useMemo(() => {
    if (mode === "Recovery") {
      return [
        { label: "Observed recovery permits", value: recoveryCount == null ? "—" : String(recoveryCount), note: formatWindow(recovery) },
        { label: "Signal state", value: recoveryCount === 0 ? "EARLY" : recoveryCount == null ? "—" : "ACTIVE", note: recoveryLabel },
        { label: "Baseline sites", value: baselineCount == null ? "—" : String(baselineSummary.distinctSites), note: `${baselineCount ?? 0} cached permit rows before the fire` },
        { label: "Shovels geography", value: recovery?.query?.geoId ?? INCIDENT.geoId, note: "Big Sur / south coast scope" },
      ];
    }

    if (mode === "Capacity") {
      const dominant = baselineSummary.dominantTags[0];
      return [
        { label: "Distinct baseline sites", value: baselineCount == null ? "—" : String(baselineSummary.distinctSites), note: `${baselineCount ?? 0} permit rows collapse to site-level activity` },
        { label: "Median file → issue", value: baselineSummary.medianApprovalDays == null ? "—" : `${formatNumber(baselineSummary.medianApprovalDays)}d`, note: `${baselineSummary.approvalSampleSize} issued records in cached sample` },
        { label: "Known contractors", value: baselineCount == null ? "—" : String(baselineSummary.knownContractors), note: "Only contractor IDs present in cached records" },
        { label: "Dominant trade signal", value: dominant ? dominant[0].replaceAll("_", " ").toUpperCase() : "—", note: dominant ? `${dominant[1]} tagged permit rows` : "No tagged activity in sample" },
      ];
    }

    return [
      { label: "Incident perimeter", value: acres == null ? "—" : `${formatNumber(acres)} ac`, note: perimeterState === "ready" ? "Live WFIGS polygon acreage" : "Resolving perimeter" },
      { label: "Mapped structures exposed", value: mappedStructures == null ? "—" : formatNumber(mappedStructures), note: buildingState === "ready" ? "Monterey County footprints intersecting perimeter" : "Resolving county GIS" },
      { label: "Baseline sites mapped", value: baselineCount == null ? "—" : `${baselineSummary.mappedSites.length}/${baselineSummary.distinctSites}`, note: "Unique Shovels sites; one cached site lacks coordinates" },
      { label: "Post-fire permit activity", value: recoveryCount == null ? "—" : String(recoveryCount), note: recoveryMatches != null ? `${formatNumber(recoveryMatches)} total matches in cached query` : recoveryLabel },
    ];
  }, [acres, baselineCount, baselineSummary, buildingState, mappedStructures, mode, perimeterState, recovery, recoveryCount, recoveryLabel, recoveryMatches]);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">RECOVERY RADAR</span>
          <h1>Turn incident geometry into built-world intelligence.</h1>
        </div>
        <span className="status"><i /> {INCIDENT.name} · live prototype</span>
      </header>

      <section className="hero-grid">
        <article className="map-stage">
          <IncidentMap perimeter={perimeter} state={perimeterState} baselinePermits={baselineSummary.mappedSites} />
          <div className="map-copy">
            <span className="eyebrow">ACTIVE INCIDENT · {INCIDENT.county.toUpperCase()}</span>
            <strong>{perimeter?.name ?? INCIDENT.name}</strong>
            <p>
              Started {formatDate(perimeter?.discoveredAt)}. The perimeter is live from WFIGS; white points are deduplicated pre-fire Shovels sites from the cached sample.
              {mappedStructures != null ? ` ${formatNumber(mappedStructures)} mapped building footprints intersect the current perimeter.` : acres != null ? ` ${formatNumber(acres)} acres are represented by the incident geometry.` : ""}
            </p>
          </div>
        </article>

        <aside className="incident-card">
          <span className="eyebrow">OBSERVATION STATE</span>
          <h2>{mappedStructures != null ? `${formatNumber(mappedStructures)} mapped structures intersect the fire perimeter.` : perimeterState === "ready" ? "The incident surface is live." : "Incident intelligence is coming online."}</h2>
          <ol>
            <li><b>01</b><span><strong>Impact</strong>{mappedStructures != null ? "Live perimeter × county building footprints. Exposure proxy only; not confirmed damage." : "Resolve what exists inside the incident perimeter."}</span></li>
            <li><b>02</b><span><strong>Recovery</strong>{recoveryLabel}. Absence is reported as observation, not fact.</span></li>
            <li><b>03</b><span><strong>Capacity</strong>{baselineCount != null ? `${baselineCount} permit rows resolve to ${baselineSummary.distinctSites} distinct pre-fire sites.` : "Compare emerging rebuild demand against normal local throughput."}</span></li>
          </ol>
        </aside>
      </section>

      <nav className="tabs" aria-label="Intelligence modes">
        {(["Impact", "Recovery", "Capacity"] as Mode[]).map((item) => (
          <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{item}</button>
        ))}
        <span>Evidence travels with every derived metric.</span>
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
          <span className="eyebrow">EVIDENCE MODE</span>
          <strong>{mode === "Impact" && perimeterState === "ready" ? "Live incident + public structure evidence" : snapshotState === "ready" ? "Cached Shovels snapshot loaded" : snapshotState === "loading" ? "Loading cached evidence…" : "No committed Shovels snapshot found yet"}</strong>
        </div>
        <div className="evidence-facts">
          {mode === "Impact" ? (
            <>
              <span><b>Perimeter source</b> WFIGS Interagency Perimeters · updated {formatDate(perimeter?.perimeterUpdatedAt)}</span>
              <span><b>Structure source</b> Monterey County Building Footprints · {buildingImpact?.exposure?.datasetVintage ?? "2010 LiDAR-derived"}</span>
              <span><b>Baseline mapping</b> {baselineSummary.distinctSites || "—"} distinct sites identified; {baselineSummary.mappedSites.length || "—"} geocoded and mapped.</span>
              <span><b>Interpretation</b> Spatial intersection is an exposure proxy. Dataset age and perimeter uncertainty mean this is not a damage count.</span>
            </>
          ) : mode === "Capacity" ? (
            <>
              <span><b>Baseline window</b> {formatWindow(baseline)}</span>
              <span><b>Observed stated value</b> {formatMoney(baselineSummary.statedValue)} across {baselineSummary.statedValueRecords} of {baselineCount ?? 0} rows with non-zero value.</span>
              <span><b>Value concentration</b> {baselineSummary.largestValueShare == null ? "—" : `${Math.round(baselineSummary.largestValueShare * 100)}%`} of observed stated value is in the single largest record.</span>
              <span><b>Interpretation</b> This is a 10-row sample with repeated sites and incomplete values; it is not yet a throughput or market-size estimate.</span>
            </>
          ) : (
            <>
              <span><b>Scope</b> ZIP {recovery?.query?.geoId ?? INCIDENT.geoId}</span>
              <span><b>Recovery window</b> {formatWindow(recovery)}</span>
              <span><b>Observed permits</b> {recoveryCount ?? "—"}</span>
              <span><b>Interpretation</b> {recoveryCount === 0 ? "No matching records observed; not proof of no activity." : "Evidence is limited to the cached query."}</span>
            </>
          )}
        </div>
      </section>

      <footer>
        <span>WFIGS + county GIS → impact · cached Shovels → recovery/capacity</span>
        <span>Exposure ≠ damage · permit rows ≠ projects · absence ≠ proof</span>
      </footer>
    </main>
  );
}
