import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

const WFIGS_CURRENT_PERIMETERS =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query";

interface WfigsProperties {
  poly_IncidentName?: string;
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
  containmentPct?: number;
  discoveredAt?: string;
  state?: string;
  geometry: Polygon | MultiPolygon;
  source: "wfigs";
}

function arcgisLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

export async function findCurrentFirePerimeter(name: string): Promise<FirePerimeter | null> {
  const where = `UPPER(poly_IncidentName)=UPPER('${arcgisLiteral(name)}')`;
  const url = new URL(WFIGS_CURRENT_PERIMETERS);
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("f", "geojson");

  const response = await fetch(url, {
    headers: { Accept: "application/geo+json, application/json" },
  });

  if (!response.ok) {
    throw new Error(`WFIGS request failed: ${response.status}`);
  }

  const collection = (await response.json()) as FeatureCollection<Polygon | MultiPolygon, WfigsProperties>;
  const feature = collection.features[0];
  if (!feature?.geometry) return null;

  const p = feature.properties ?? {};
  const timestamp = p.attr_FireDiscoveryDateTime;

  return {
    id: p.attr_UniqueFireIdentifier ?? String(feature.id ?? name),
    name: p.poly_IncidentName ?? p.attr_IncidentName ?? name,
    acres: p.attr_IncidentSize,
    containmentPct: p.attr_PercentContained,
    discoveredAt: timestamp ? new Date(timestamp).toISOString() : undefined,
    state: p.attr_POOState,
    geometry: feature.geometry,
    source: "wfigs",
  };
}
