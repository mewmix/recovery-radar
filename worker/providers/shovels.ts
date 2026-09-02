const SHOVELS_BASE = "https://api.shovels.ai/v2";

export interface ShovelsEnv {
  SHOVELS_API_KEY: string;
}

export interface PermitSearchInput {
  geoId: string;
  permitFrom: string;
  permitTo: string;
  size?: number;
  cursor?: string;
  includeCount?: boolean;
  tags?: string[];
}

export async function searchPermits(env: ShovelsEnv, input: PermitSearchInput): Promise<unknown> {
  const url = new URL(`${SHOVELS_BASE}/permits/search`);
  url.searchParams.set("geo_id", input.geoId);
  url.searchParams.set("permit_from", input.permitFrom);
  url.searchParams.set("permit_to", input.permitTo);
  url.searchParams.set("size", String(Math.min(Math.max(input.size ?? 100, 1), 100)));

  if (input.cursor) url.searchParams.set("cursor", input.cursor);
  if (input.includeCount) url.searchParams.set("include_count", "true");
  for (const tag of input.tags ?? []) url.searchParams.append("permit_tags", tag);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-API-Key": env.SHOVELS_API_KEY,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Shovels request failed: ${response.status} ${detail.slice(0, 300)}`);
  }

  return response.json();
}
