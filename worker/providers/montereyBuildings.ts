import type { MultiPolygon, Polygon, Position } from "geojson";

const MONTEREY_BUILDINGS =
  "https://maps.co.monterey.ca.us/server/rest/services/Locations/Building_Footprints/FeatureServer/0/query";

export interface BuildingExposure {
  mappedStructureCount: number;
  source: "monterey-county-building-footprints";
  sourceUrl: string;
  datasetVintage: "2010 LiDAR-derived";
  method: "building footprints spatially intersecting current incident perimeter";
}

function signedArea(ring: Position[]): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += (x1 * y2) - (x2 * y1);
  }
  return area / 2;
}

function arcgisRing(ring: Position[], outer: boolean): Position[] {
  // GeoJSON convention: exterior CCW, holes CW. Esri polygon JSON expects the opposite.
  const clockwise = signedArea(ring) < 0;
  const shouldBeClockwise = outer;
  return clockwise === shouldBeClockwise ? ring : [...ring].reverse();
}

function ringsFor(geometry: Polygon | MultiPolygon): Position[][] {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((polygon) => polygon.map((ring, index) => arcgisRing(ring, index === 0)));
}

export async function countMontereyBuildingsInPerimeter(
  geometry: Polygon | MultiPolygon,
): Promise<BuildingExposure> {
  const esriGeometry = {
    rings: ringsFor(geometry),
    spatialReference: { wkid: 4326 },
  };

  const body = new URLSearchParams({
    where: "1=1",
    geometry: JSON.stringify(esriGeometry),
    geometryType: "esriGeometryPolygon",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    returnCountOnly: "true",
    f: "json",
  });

  const response = await fetch(MONTEREY_BUILDINGS, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Monterey building footprint request failed: ${response.status}`);
  }

  const result = await response.json() as { count?: number; error?: { message?: string } };
  if (result.error) {
    throw new Error(`Monterey building footprint query failed: ${result.error.message ?? "unknown ArcGIS error"}`);
  }
  if (!Number.isFinite(result.count)) {
    throw new Error("Monterey building footprint query did not return a count");
  }

  return {
    mappedStructureCount: Number(result.count),
    source: "monterey-county-building-footprints",
    sourceUrl: "https://maps.co.monterey.ca.us/server/rest/services/Locations/Building_Footprints/FeatureServer/0",
    datasetVintage: "2010 LiDAR-derived",
    method: "building footprints spatially intersecting current incident perimeter",
  };
}
