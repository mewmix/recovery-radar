import type { MultiPolygon, Polygon, Position } from "geojson";

export type ExposureClass = "inside" | "near" | "outside";

export type SiteExposure = {
  exposure: ExposureClass;
  distanceKm: number;
};

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_AT_EQUATOR = 111.32;

function pointOnSegment(point: Position, a: Position, b: Position, epsilon = 1e-10): boolean {
  const [x, y] = point;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  if (Math.abs(cross) > epsilon) return false;
  const dot = (x - x1) * (x2 - x1) + (y - y1) * (y2 - y1);
  if (dot < -epsilon) return false;
  const squaredLength = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  return dot <= squaredLength + epsilon;
}

function pointInRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (pointOnSegment(point, a, b)) return true;

    const [x, y] = point;
    const [xi, yi] = b;
    const [xj, yj] = a;
    const intersects = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonCoordinates(point: Position, rings: Position[][]): boolean {
  if (!rings.length || !pointInRing(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(point, rings[i])) return false;
  }
  return true;
}

export function pointInGeometry(point: Position, geometry: Polygon | MultiPolygon): boolean {
  if (geometry.type === "Polygon") return pointInPolygonCoordinates(point, geometry.coordinates);
  return geometry.coordinates.some((polygon) => pointInPolygonCoordinates(point, polygon));
}

function localXY(point: Position, origin: Position): [number, number] {
  const meanLatRad = ((point[1] + origin[1]) / 2) * Math.PI / 180;
  return [
    (point[0] - origin[0]) * KM_PER_DEG_LON_AT_EQUATOR * Math.cos(meanLatRad),
    (point[1] - origin[1]) * KM_PER_DEG_LAT,
  ];
}

function pointToSegmentKm(point: Position, a: Position, b: Position): number {
  const [ax, ay] = localXY(a, point);
  const [bx, by] = localXY(b, point);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(ax, ay);
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function rings(geometry: Polygon | MultiPolygon): Position[][] {
  return geometry.type === "Polygon"
    ? geometry.coordinates
    : geometry.coordinates.flatMap((polygon) => polygon);
}

export function distanceToBoundaryKm(point: Position, geometry: Polygon | MultiPolygon): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const ring of rings(geometry)) {
    for (let i = 1; i < ring.length; i += 1) {
      nearest = Math.min(nearest, pointToSegmentKm(point, ring[i - 1], ring[i]));
    }
    if (ring.length > 2) nearest = Math.min(nearest, pointToSegmentKm(point, ring[ring.length - 1], ring[0]));
  }
  return nearest;
}

export function classifySiteExposure(
  lng: number,
  lat: number,
  geometry: Polygon | MultiPolygon,
  nearThresholdKm = 5,
): SiteExposure {
  const point: Position = [lng, lat];
  if (pointInGeometry(point, geometry)) return { exposure: "inside", distanceKm: 0 };
  const distanceKm = distanceToBoundaryKm(point, geometry);
  return {
    exposure: distanceKm <= nearThresholdKm ? "near" : "outside",
    distanceKm,
  };
}
