import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

const WFIGS_CURRENT_PERIMETERS =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query";

interface WfigsProperties {
  poly_IncidentName?: string;
  poly_GISAcres?: number;
  poly_DateCurrent?: number;
  poly_PolygonDateTime?: number;
  attr_IncidentName?: string;
  attr_IncidentSize?: number;
  attr_PercentContained?: number;
  attr_FireDiscoveryDateTime?: number;
  attr_POOState?: string;
  attr_UniqueFireIdentifier?: string;
}

export interface FirePerimeter {
  id: string;
  name: string;
  acres?: number;
  reportedIncidentAcres?: number;
  containmentPct?: number;
  discoveredAt?: string;
  perimeterUpdatedAt?: string;
  state?: string;
  geometry: Polygon | MultiPolygon;
  source: "wfigs";
}

function arcgisLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function isoTimestamp(value?: number): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalized(value?: string): string {
  return value?.trim().toUpperCase().replace(/\s+FIRE$/, "") ?? "";
}

export async function findCurrentFirePerimeter(name: string): Promise<FirePerimeter | null> {
  const escaped = arcgisLiteral(name.trim());
  const where = `UPPER(poly_IncidentName) LIKE UPPER('%${escaped}%')`;
  const url = new URL(WFIGS_CURRENT_PERIMETERS);
  url.searchParams.set("where", where);
  url.searchParams.set(
    "outFields",
    [
      "poly_IncidentName",
      "poly_GISAcres",
      "poly_DateCurrent",
      "poly_PolygonDateTime",
      "attr_IncidentName",
      "attr_IncidentSize",
      "attr_PercentContained",
      "attr_FireDiscoveryDateTime",
      "attr_POOState",
      "attr_UniqueFireIdentifier",
    ].join(","),
  );
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("resultRecordCount", "10");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("f", "geojson");

  const response = await fetch(url, {
    headers: { Accept: "application/geo+json, application/json" },
  });

  if (!response.ok) {
    throw new Error(`WFIGS request failed: ${response.status}`);
  }

  const collection = (await response.json()) as FeatureCollection<Polygon | MultiPolygon, WfigsProperties>;
  const target = normalized(name);
  const feature = collection.features.find((candidate) => {
    const p = candidate.properties;
    return normalized(p?.poly_IncidentName) === target || normalized(p?.attr_IncidentName) === target;
  }) ?? collection.features[0];

  if (!feature?.geometry) return null;

  const p = feature.properties ?? {};

  return {
    id: p.attr_UniqueFireIdentifier ?? String(feature.id ?? name),
    name: p.poly_IncidentName ?? p.attr_IncidentName ?? name,
    acres: p.poly_GISAcres ?? p.attr_IncidentSize,
    reportedIncidentAcres: p.attr_IncidentSize,
    containmentPct: p.attr_PercentContained,
    discoveredAt: isoTimestamp(p.attr_FireDiscoveryDateTime),
    perimeterUpdatedAt: isoTimestamp(p.poly_DateCurrent ?? p.poly_PolygonDateTime),
    state: p.attr_POOState,
    geometry: feature.geometry,
    source: "wfigs",
  };
}
