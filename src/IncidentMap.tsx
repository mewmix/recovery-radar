import { useEffect, useRef } from "react";
import maplibregl, { LngLatBounds, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import type { MultiPolygon, Polygon, Position } from "geojson";

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

type Props = {
  perimeter: FirePerimeter | null;
  state: "loading" | "ready" | "missing";
};

const SOURCE_ID = "incident-perimeter";
const FILL_LAYER_ID = "incident-perimeter-fill";
const LINE_LAYER_ID = "incident-perimeter-line";

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

function boundsFor(geometry: Polygon | MultiPolygon): LngLatBounds | null {
  const points = coordinates(geometry);
  if (!points.length) return null;
  const first: [number, number] = [points[0][0], points[0][1]];
  return points.reduce((bounds, point) => bounds.extend([point[0], point[1]]), new LngLatBounds(first, first));
}

export function IncidentMap({ perimeter, state }: Props) {
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

      const bounds = boundsFor(perimeter.geometry);
      if (bounds) map.fitBounds(bounds, { padding: 54, maxZoom: 12, duration: 900 });
    };

    if (map.loaded()) apply();
    else map.once("load", apply);
  }, [perimeter]);

  return (
    <div className="incident-map-wrap">
      <div ref={containerRef} className="incident-map" aria-label="Interactive Plaskett Fire perimeter map" />
      <div className={`map-state map-state-${state}`}>
        <span className="map-state-dot" />
        {state === "ready" ? "WFIGS perimeter live" : state === "loading" ? "Resolving WFIGS perimeter…" : "Perimeter unavailable"}
      </div>
    </div>
  );
}
