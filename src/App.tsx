import { useEffect, useMemo, useState } from "react";

type Dataset = {
  updatedAt?: string;
  query?: {
    geoId?: string;
    permitFrom?: string;
    permitTo?: string;
  };
  permitCount?: number;
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

export function App() {
  const [mode, setMode] = useState<Mode>("Impact");
  const [artifact, setArtifact] = useState<IncidentArtifact | null>(null);
  const [snapshotState, setSnapshotState] = useState<"loading" | "ready" | "missing">("loading");

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
    return () => { cancelled = true; };
  }, []);

  const baseline = artifact?.shovels?.datasets?.baseline;
  const recovery = artifact?.shovels?.datasets?.recovery;
  const recoveryCount = recovery?.permitCount;
  const baselineCount = baseline?.permitCount;

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
      { label: "Properties exposed", value: "—", note: "Next: perimeter × property geometry" },
      { label: "Pre-fire permit sample", value: baselineCount == null ? "—" : String(baselineCount), note: formatWindow(baseline) },
      { label: "Post-fire permit activity", value: recoveryCount == null ? "—" : String(recoveryCount), note: recoveryLabel },
      { label: "Analysis geography", value: INCIDENT.geoId, note: "ZIP scope; polygon filter follows" },
    ];
  }, [baseline, baselineCount, mode, recovery, recoveryCount, recoveryLabel]);

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
          <div className="map-grid" />
          <div className="map-copy">
            <span className="eyebrow">ACTIVE INCIDENT · {INCIDENT.county.toUpperCase()}</span>
            <strong>{INCIDENT.name}</strong>
            <p>Started {INCIDENT.startedAt}. Current analysis is intentionally narrow: ZIP {INCIDENT.geoId}, cached Shovels enrichment, and no request-time credit consumption.</p>
          </div>
          <div className="crosshair" aria-hidden="true" />
        </article>

        <aside className="incident-card">
          <span className="eyebrow">OBSERVATION STATE</span>
          <h2>{recoveryCount === 0 ? "Recovery signal has not appeared yet." : "Incident intelligence is coming online."}</h2>
          <ol>
            <li><b>01</b><span><strong>Impact</strong>Resolve what exists inside the incident perimeter.</span></li>
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
          <strong>{snapshotState === "ready" ? "Cached Shovels snapshot loaded" : snapshotState === "loading" ? "Loading cached evidence…" : "No committed snapshot found yet"}</strong>
        </div>
        <div className="evidence-facts">
          <span><b>Scope</b> ZIP {recovery?.query?.geoId ?? INCIDENT.geoId}</span>
          <span><b>Recovery window</b> {formatWindow(recovery)}</span>
          <span><b>Observed permits</b> {recoveryCount ?? "—"}</span>
          <span><b>Interpretation</b> {recoveryCount === 0 ? "No matching records observed; not proof of no activity." : "Evidence is limited to the cached query."}</span>
        </div>
      </section>

      <footer>
        <span>WFIGS / CAL FIRE → incident adapter → cached Shovels enrichment → deterministic analysis</span>
        <span>Exposure ≠ damage · absence ≠ proof</span>
      </footer>
    </main>
  );
}
