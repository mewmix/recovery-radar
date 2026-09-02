import { useEffect, useRef } from "react";
import maplibregl, { LngLatBounds, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, MultiPolygon, Point, Polygon, Position } from "geojson";
import type { ExposureClass } from "./geo";

export type FirePerimeter = {
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
};

export type PermitMapPoint = {
  id: string;
  lat: number;
  lng: number;
  status?: string | null;
  tags?: string[];
  jobValue?: number | null;
  exposure?: ExposureClass;
  distanceKm?: number;
};

type Props = {
  perimeter: FirePerimeter | null;
  state: "loading" | "ready" | "missing";
  baselinePermits?: PermitMapPoint[];
};

const SOURCE_ID = "incident-perimeter";
const FILL_LAYER_ID = "incident-perimeter-fill";
const LINE_LAYER_ID = "incident-perimeter-line";
const BASELINE_SOURCE_ID = "baseline-permits";
const BASELINE_LAYER_ID = "baseline-permits-circle";

function coordinates(geometry: Polygon | MultiPolygon): Position[] {
  const output: Position[] = [];
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      output.push(value as Position);
      return;
    }
    for (const child of value) walk(child);
  };
  walk(geometry.coordinates);
  return output;
}

function combinedBounds(perimeter: FirePerimeter | null, points: PermitMapPoint[]): LngLatBounds | null {
  const perimeterPoints = perimeter ? coordinates(perimeter.geometry) : [];
  const all = [
    ...perimeterPoints.map((point) => [point[0], point[1]] as [number, number]),
    ...points.map((point) => [point.lng, point.lat] as [number, number]),
  ];
  if (!all.length) return null;
  const bounds = new LngLatBounds(all[0], all[0]);
  for (const point of all.slice(1)) bounds.extend(point);
  return bounds;
}

function baselineGeoJson(points: PermitMapPoint[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.lng, point.lat] },
      properties: {
        id: point.id,
        status: point.status ?? "unknown",
        tags: (point.tags ?? []).join(", "),
        jobValue: point.jobValue ?? 0,
        exposure: point.exposure ?? "outside",
        distanceKm: point.distanceKm ?? null,
      },
    })),
  };
}

function formatObservedValue(value: number): string {
  if (!(value > 0)) return "no stated value";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function IncidentMap({ perimeter, state, baselinePermits = [] }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/dark",
      center: [-121.41472, 35.90356],
      zoom: 8.6,
      attributionControl: false,
      cooperativeGestures: true,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !perimeter) return;

    const data = {
      type: "Feature" as const,
      properties: { name: perimeter.name },
      geometry: perimeter.geometry,
    };

    const apply = () => {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
      } else {
        map.addSource(SOURCE_ID, { type: "geojson", data });
        map.addLayer({
          id: FILL_LAYER_ID,
          type: "fill",
          source: SOURCE_ID,
          paint: {
            "fill-color": "#ff5d45",
            "fill-opacity": 0.24,
          },
        });
        map.addLayer({
          id: LINE_LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          paint: {
            "line-color": "#ff7964",
            "line-width": 2.4,
            "line-opacity": 0.95,
          },
        });
      }

      const bounds = combinedBounds(perimeter, baselinePermits);
      if (bounds) map.fitBounds(bounds, { padding: 64, maxZoom: 12, duration: 900 });
    };

    if (map.loaded()) apply();
    else map.once("load", apply);
  }, [perimeter, baselinePermits]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const data = baselineGeoJson(baselinePermits);
    const apply = () => {
      const source = map.getSource(BASELINE_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
      } else {
        map.addSource(BASELINE_SOURCE_ID, { type: "geojson", data });
        map.addLayer({
          id: BASELINE_LAYER_ID,
          type: "circle",
          source: BASELINE_SOURCE_ID,
          paint: {
            "circle-radius": ["match", ["get", "exposure"], "inside", 7, "near", 6, 5],
            "circle-color": [
              "match",
              ["get", "exposure"],
              "inside", "#ff5d45",
              "near", "#f2c94c",
              "#f3f5f7",
            ],
            "circle-stroke-color": "#090b0d",
            "circle-stroke-width": 1.5,
            "circle-opacity": 0.95,
          },
        });

        map.on("mouseenter", BASELINE_LAYER_ID, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", BASELINE_LAYER_ID, () => { map.getCanvas().style.cursor = ""; });
        map.on("click", BASELINE_LAYER_ID, (event) => {
          const feature = event.features?.[0];
          if (!feature || feature.geometry.type !== "Point") return;
          const properties = feature.properties ?? {};
          const distance = Number(properties.distanceKm);
          const exposure = String(properties.exposure ?? "outside").toUpperCase();
          const distanceText = Number.isFinite(distance)
            ? exposure === "INSIDE" ? "inside current perimeter" : `${distance.toFixed(1)} km from perimeter`
            : "distance unavailable";
          const tags = String(properties.tags ?? "").trim() || "untagged activity";
          const value = Number(properties.jobValue ?? 0);
          new maplibregl.Popup({ closeButton: false, offset: 9 })
            .setLngLat(feature.geometry.coordinates as [number, number])
            .setText(`${exposure} · ${distanceText} · ${tags} · ${formatObservedValue(value)}`)
            .addTo(map);
        });
      }

      const bounds = combinedBounds(perimeter, baselinePermits);
      if (bounds) map.fitBounds(bounds, { padding: 64, maxZoom: 12, duration: 700 });
    };

    if (map.loaded()) apply();
    else map.once("load", apply);
  }, [baselinePermits, perimeter]);

  return (
    <div className="incident-map-wrap">
      <div ref={containerRef} className="incident-map" aria-label="Interactive Plaskett Fire perimeter and baseline activity map" />
      <div className={`map-state map-state-${state}`}>
        <span className="map-state-dot" />
        {state === "ready" ? "WFIGS perimeter live · site proximity classified" : state === "loading" ? "Resolving WFIGS perimeter…" : "Perimeter unavailable"}
      </div>
    </div>
  );
}
