const demoMetrics = [
  { label: "Properties exposed", value: "—", note: "Awaiting incident geometry" },
  { label: "Built value exposed", value: "—", note: "Shovels property intelligence" },
  { label: "Recent permits", value: "—", note: "Pre-incident baseline" },
  { label: "Recovery velocity", value: "—", note: "Activates post-incident" },
];

export function App() {
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">RECOVERY RADAR</span>
          <h1>Turn incident geometry into built-world intelligence.</h1>
        </div>
        <span className="status"><i /> California · prototype</span>
      </header>

      <section className="hero-grid">
        <article className="map-stage">
          <div className="map-grid" />
          <div className="map-copy">
            <span className="eyebrow">INCIDENT SURFACE</span>
            <strong>Drop in a fire perimeter.</strong>
            <p>Recovery Radar resolves the affected built environment, snapshots the pre-event baseline, and starts watching recovery.</p>
          </div>
          <div className="crosshair" aria-hidden="true" />
        </article>

        <aside className="incident-card">
          <span className="eyebrow">DEPLOYMENT MODEL</span>
          <h2>One incident in.<br />Three decision surfaces out.</h2>
          <ol>
            <li><b>01</b><span><strong>Impact</strong>What exists inside the incident geometry?</span></li>
            <li><b>02</b><span><strong>Recovery</strong>How quickly is rebuilding actually moving?</span></li>
            <li><b>03</b><span><strong>Capacity</strong>Can local contractors and jurisdictions absorb demand?</span></li>
          </ol>
        </aside>
      </section>

      <nav className="tabs" aria-label="Intelligence modes">
        <button className="active">Impact</button>
        <button>Recovery</button>
        <button>Capacity</button>
        <span>Evidence travels with every derived metric.</span>
      </nav>

      <section className="metrics">
        {demoMetrics.map((metric) => (
          <article key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.note}</small>
          </article>
        ))}
      </section>

      <footer>
        <span>CAL FIRE → incident adapter → Shovels → deterministic analysis</span>
        <span>Exposure ≠ confirmed damage</span>
      </footer>
    </main>
  );
}
