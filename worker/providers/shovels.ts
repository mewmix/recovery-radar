const SHOVELS_BASE = "https://api.shovels.ai/v2";

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function headerInt(response: Response, name: string): number | null {
  const raw = response.headers.get(name);
  if (raw == null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getJson(apiKey: string, path: string, params?: Record<string, string | number | boolean | undefined>): Promise<{ response: Response; body: any }> {
  const url = new URL(`${SHOVELS_BASE}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-API-Key": apiKey,
    },
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`Shovels ${path} failed: ${response.status} ${text.slice(0, 240)}`);
  }
  return { response, body };
}

export type ShovelsUsage = {
  used: number | null;
  limit: number | null;
  remaining: number | null;
};

export async function getShovelsUsage(apiKey: string): Promise<ShovelsUsage> {
  const { response, body } = await getJson(apiKey, "/usage");
  const used = numeric(body?.credits_used ?? body?.credit_used ?? body?.used);
  const limit = headerInt(response, "X-Credits-Limit") ?? numeric(body?.credit_limit ?? body?.credits_limit ?? body?.limit);
  const directRemaining = headerInt(response, "X-Credits-Remaining")
    ?? numeric(body?.credits_remaining ?? body?.remaining_credits ?? body?.remaining ?? body?.credit_remaining);
  const remaining = directRemaining ?? (used != null && limit != null ? Math.max(0, limit - used) : null);
  return { used, limit, remaining };
}

export type PublicPermit = {
  id: string | null;
  status: string | null;
  tags: string[];
  description: string | null;
  jurisdiction: string | null;
  propertyType: string | null;
  jobValue: number | null;
  contractorId: string | null;
  approvalDuration: number | null;
  constructionDuration: number | null;
  inspectionPassRate: number | null;
  dates: {
    file: string | null;
    issue: string | null;
    start: string | null;
    end: string | null;
  };
  location: {
    lat: number | null;
    lng: number | null;
    city: string | null;
    zip: string | null;
    state: string | null;
  };
  geoIds: Record<string, unknown> | null;
};

export function sanitizePermit(permit: any): PublicPermit {
  const latlng = permit?.address?.latlng;
  return {
    id: permit?.id ?? permit?.permit_id ?? null,
    status: permit?.status ?? null,
    tags: Array.isArray(permit?.tags) ? permit.tags : [],
    description: permit?.description_derived ?? permit?.description ?? null,
    jurisdiction: permit?.jurisdiction ?? null,
    propertyType: permit?.property_type ?? null,
    jobValue: numeric(permit?.job_value),
    contractorId: permit?.contractor_id ?? null,
    approvalDuration: numeric(permit?.approval_duration),
    constructionDuration: numeric(permit?.construction_duration),
    inspectionPassRate: numeric(permit?.inspection_pass_rate),
    dates: {
      file: permit?.file_date ?? null,
      issue: permit?.issue_date ?? null,
      start: permit?.start_date ?? null,
      end: permit?.end_date ?? permit?.final_date ?? null,
    },
    location: {
      lat: Array.isArray(latlng) ? numeric(latlng[0]) : null,
      lng: Array.isArray(latlng) ? numeric(latlng[1]) : null,
      city: permit?.address?.city ?? null,
      zip: permit?.address?.zip_code ?? null,
      state: permit?.address?.state ?? null,
    },
    geoIds: permit?.geo_ids && typeof permit.geo_ids === "object" ? permit.geo_ids : null,
  };
}

export type PermitSearchResult = {
  permits: PublicPermit[];
  nextCursor: string | null;
  consumed: number;
  remaining: number | null;
};

export async function searchShovelsPermits(
  apiKey: string,
  input: {
    geoId: string;
    permitFrom: string;
    permitTo: string;
    size: number;
    cursor?: string | null;
  },
): Promise<PermitSearchResult> {
  const { response, body } = await getJson(apiKey, "/permits/search", {
    geo_id: input.geoId,
    permit_from: input.permitFrom,
    permit_to: input.permitTo,
    size: input.size,
    cursor: input.cursor ?? undefined,
  });

  const items = Array.isArray(body?.items) ? body.items : [];
  return {
    permits: items.map(sanitizePermit),
    nextCursor: typeof body?.next_cursor === "string" && body.next_cursor ? body.next_cursor : null,
    consumed: headerInt(response, "X-Credits-Request") ?? items.length,
    remaining: headerInt(response, "X-Credits-Remaining"),
  };
}
