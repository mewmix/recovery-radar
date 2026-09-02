import { useEffect, useMemo, useState } from "react";
import { IncidentMap, type FirePerimeter } from "./IncidentMap";

type Dataset = {
  updatedAt?: string;
  query?: {
    geoId?: string;
    permitFrom?: string;
    permitTo?: string;
  };
  permitCount?: number;
  totalMatches?: number | null;
  permits?: unknown[];
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

function formatDate(value?: string): string {
  if (!value) return INCIDENT.startedAt;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return INCIDENT.startedAt;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function App() {
  const [mode, setMode] = useState<Mode>("Impact");
  const [artifact, setArtifact] = useState<IncidentArtifact | null>(null);
  const [snapshotState, setSnapshotState] = useState<LoadState>("loading");
  const [perimeter, setPerimeter] = useState<FirePerimeter | null>(null);
  const [perimeterState, setPerimeterState] = useState<LoadState>("loading");

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

    return () => { cancelled = true; };
  }, []);

  const baseline = artifact?.shovels?.datasets?.baseline;
  const recovery = artifact?.shovels?.datasets?.recovery;
  const recoveryCount = recovery?.permitCount;
  const baselineCount = baseline?.permitCount;
  const recoveryMatches = recovery?.totalMatches;
  const acres = perimeter?.acres;
  const containment = perimeter?.containmentPct;

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
        { label: "Baseline sample", value: baselineCount == null ? "—" : String(baselineCount), note: formatWindow(baseline) },
        { label: "Shovels geography", value: recovery?.query?.geoId ?? INCIDENT.geoId, note: "Big Sur / south coast scope" },
      ];
    }

    if (mode === "Capacity") {
      return [
        { label: "Contractor pressure", value: "—", note: "Activates after contractor enrichment" },
        { label: "Permit throughput", value: baselineCount == null ? "—" : String(baselineCount), note: "Current cached baseline sample" },
        { label: "Approval friction", value: "—", note: "Jurisdiction metrics next" },
        { label: "Capacity model", value: "PENDING", note: "No invented estimate before evidence" },
      ];
    }

    return [
      { label: "Incident perimeter", value: acres == null ? "—" : `${formatNumber(acres)} ac`, note: perimeterState === "ready" ? "Live WFIGS perimeter metadata" : "Resolving perimeter" },
      { label: "Containment", value: containment == null ? "—" : `${formatNumber(containment)}%`, note: perimeterState === "ready" ? "Reported with current perimeter" : "Awaiting WFIGS" },
      { label: "Post-fire permit activity", value: recoveryCount == null ? "—" : String(recoveryCount), note: recoveryMatches != null ? `${formatNumber(recoveryMatches)} total matches in cached query` : recoveryLabel },
      { label: "Built-world exposure", value: "NEXT", note: "Polygon × public structure/property layer" },
    ];
  }, [acres, baselineCount, containment, mode, perimeterState, recovery, recoveryCount, recoveryLabel, recoveryMatches]);

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
          <IncidentMap perimeter={perimeter} state={perimeterState} />
          <div className="map-copy">
            <span className="eyebrow">ACTIVE INCIDENT · {INCIDENT.county.toUpperCase()}</span>
            <strong>{perimeter?.name ?? INCIDENT.name}</strong>
            <p>
              Started {formatDate(perimeter?.discoveredAt)}. The perimeter is live from WFIGS; Shovels remains cached and credit-safe.
              {acres != null ? ` ${formatNumber(acres)} acres are currently represented by the incident geometry.` : ""}
            </p>
          </div>
        </article>

        <aside className="incident-card">
          <span className="eyebrow">OBSERVATION STATE</span>
          <h2>{perimeterState === "ready" ? "The incident surface is live." : "Incident intelligence is coming online."}</h2>
          <ol>
            <li><b>01</b><span><strong>Impact</strong>{perimeterState === "ready" ? "Authoritative perimeter geometry resolved; built-world intersection is next." : "Resolve what exists inside the incident perimeter."}</span></li>
            <li><b>02</b><span><strong>Recovery</strong>{recoveryLabel}. Absence is reported as observation, not fact.</span></li>
            <li><b>03</b><span><strong>Capacity</strong>Compare emerging rebuild demand against normal local throughput.</span></li>
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
          <strong>{mode === "Impact" && perimeterState === "ready" ? "Live WFIGS perimeter loaded" : snapshotState === "ready" ? "Cached Shovels snapshot loaded" : snapshotState === "loading" ? "Loading cached evidence…" : "No committed Shovels snapshot found yet"}</strong>
        </div>
        <div className="evidence-facts">
          {mode === "Impact" ? (
            <>
              <span><b>Source</b> WFIGS Interagency Perimeters Current</span>
              <span><b>Incident ID</b> {perimeter?.id ?? "—"}</span>
              <span><b>Perimeter acres</b> {formatNumber(acres)}</span>
              <span><b>Interpretation</b> Perimeter overlap is exposure only; it does not assert structure damage.</span>
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
        <span>WFIGS / CAL FIRE → incident adapter → cached Shovels enrichment → deterministic analysis</span>
        <span>Exposure ≠ damage · absence ≠ proof</span>
      </footer>
    </main>
  );
}
