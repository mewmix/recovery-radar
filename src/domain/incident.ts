import type { MultiPolygon, Polygon } from "geojson";

export type IncidentType = "wildfire" | "flood" | "earthquake" | "tornado";

export interface IncidentSource {
  provider: string;
  id: string;
  url?: string;
  observedAt?: string;
}

export interface Incident {
  id: string;
  slug: string;
  name: string;
  type: IncidentType;
  startedAt: string;
  state: string;
  counties: string[];
  acres?: number;
  containmentPct?: number;
  geometry?: Polygon | MultiPolygon;
  source: IncidentSource;
}

export interface EvidenceDatum {
  label: string;
  value: number | string;
  source: string;
  observedAt?: string;
  note?: string;
}

export interface DerivedMetric {
  key: string;
  label: string;
  value: number;
  unit?: string;
  confidence?: number;
  evidence: EvidenceDatum[];
}

export interface IncidentSummary {
  incident: Incident;
  metrics: DerivedMetric[];
}
