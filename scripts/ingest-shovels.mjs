import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const BASE_URL = "https://api.shovels.ai/v2";
const DEFAULT_LIMIT = 25;
const DEFAULT_RESERVE = 100;

function values(name) {
  const out = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) out.push(process.argv[++i]);
  }
  return out;
}

function value(name, fallback) {
  return values(name).at(-1) ?? fallback;
}

function required(name) {
  const result = value(name);
  if (!result) throw new Error(`Missing required argument --${name}`);
  return result;
}

function integer(name, fallback, min, max) {
  const raw = value(name, String(fallback));
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function headerInt(response, name) {
  const raw = response.headers.get(name);
  if (raw == null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function numeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function usageBudget(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { used: null, limit: null, remaining: null };
  }

  const directRemaining = [
    body.credits_remaining,
    body.remaining_credits,
    body.remaining,
    body.credit_remaining,
  ]
    .map(numeric)
    .find((item) => item != null) ?? null;

  const used = numeric(body.credits_used ?? body.credit_used ?? body.used);
  const limit = numeric(body.credit_limit ?? body.credits_limit ?? body.limit);
  const remaining = directRemaining ?? (used != null && limit != null ? Math.max(0, limit - used) : null);

  return { used, limit, remaining };
}

async function shovelsGet(apiKey, path, params) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, val] of Object.entries(params ?? {})) {
    if (Array.isArray(val)) {
      for (const item of val) url.searchParams.append(key, String(item));
    } else if (val !== undefined && val !== null) {
      url.searchParams.set(key, String(val));
    }
  }

  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-API-Key": apiKey },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`Shovels ${path} failed: ${response.status} ${text.slice(0, 300)}`);
  }

  return { response, body };
}

function publicPermit(permit) {
  const latlng = permit?.address?.latlng;
  return {
    id: permit?.id ?? permit?.permit_id ?? null,
    status: permit?.status ?? null,
    tags: Array.isArray(permit?.tags) ? permit.tags : [],
    description: permit?.description_derived ?? permit?.description ?? null,
    jurisdiction: permit?.jurisdiction ?? null,
    propertyType: permit?.property_type ?? null,
    jobValue: permit?.job_value ?? null,
    contractorId: permit?.contractor_id ?? null,
    approvalDuration: permit?.approval_duration ?? null,
    constructionDuration: permit?.construction_duration ?? null,
    inspectionPassRate: permit?.inspection_pass_rate ?? null,
    dates: {
      file: permit?.file_date ?? null,
      issue: permit?.issue_date ?? null,
      start: permit?.start_date ?? null,
      end: permit?.end_date ?? permit?.final_date ?? null,
    },
    location: {
      lat: Array.isArray(latlng) ? latlng[0] ?? null : null,
      lng: Array.isArray(latlng) ? latlng[1] ?? null : null,
      city: permit?.address?.city ?? null,
      zip: permit?.address?.zip_code ?? null,
      state: permit?.address?.state ?? null,
    },
    geoIds: permit?.geo_ids ?? null,
  };
}

async function readExistingArtifact(output, slug) {
  try {
    const parsed = JSON.parse(await readFile(output, "utf8"));
    return parsed && parsed.slug === slug ? parsed : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Could not read existing incident artifact: ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  const apiKey = process.env.SHOVELS_API_KEY;
  if (!apiKey) throw new Error("SHOVELS_API_KEY is not set. Put it in .dev.vars.");

  const slug = required("slug");
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("--slug must contain only lowercase letters, numbers, and hyphens");

  const dataset = value("dataset", "recovery");
  if (!new Set(["baseline", "recovery"]).has(dataset)) {
    throw new Error("--dataset must be baseline or recovery");
  }

  const geoId = required("geo-id");
  const allowBroadGeo = process.argv.includes("--allow-broad-geo");
  if (/^[A-Z]{2}$/.test(geoId) && !allowBroadGeo) {
    throw new Error(
      `Refusing broad state-level geo-id ${geoId}. Use a ZIP/county/jurisdiction geo_id, or pass --allow-broad-geo intentionally.`,
    );
  }

  const permitFrom = required("from");
  const permitTo = required("to");
  const requestedLimit = integer("limit", DEFAULT_LIMIT, 1, 100);
  const reserve = integer("reserve", DEFAULT_RESERVE, 0, 1000000);
  const tags = values("tag");
  const dryRun = process.argv.includes("--dry-run");
  const probe = process.argv.includes("--probe");

  if (dryRun && probe) throw new Error("Use either --dry-run or --probe, not both.");

  const usage = await shovelsGet(apiKey, "/usage");
  const parsedUsage = usageBudget(usage.body);
  const remaining = headerInt(usage.response, "X-Credits-Remaining") ?? parsedUsage.remaining;
  const limit = headerInt(usage.response, "X-Credits-Limit") ?? parsedUsage.limit;

  if (remaining == null) {
    const keys = usage.body && typeof usage.body === "object" && !Array.isArray(usage.body)
      ? Object.keys(usage.body).join(", ")
      : typeof usage.body;
    throw new Error(`Could not verify remaining Shovels credits; refusing to ingest. Usage response keys: ${keys || "none"}`);
  }

  const spendable = Math.max(0, remaining - reserve);
  const targetLimit = probe ? 1 : requestedLimit;
  const effectiveLimit = Math.min(targetLimit, spendable);

  console.log(`Shovels credits: ${remaining}${limit == null ? "" : ` / ${limit}`} remaining`);
  if (parsedUsage.used != null) console.log(`Rolling usage: ${parsedUsage.used} credits`);
  console.log(`Protected reserve: ${reserve}`);
  console.log(`Dataset: ${dataset}`);
  console.log(`Geography: ${geoId}`);
  console.log(`Requested records: ${targetLimit}${probe ? " (probe mode)" : ""}`);

  if (effectiveLimit < 1) {
    throw new Error(`Sync refused: ${remaining} credits remain and ${reserve} are reserved.`);
  }

  if (!probe && effectiveLimit < requestedLimit) {
    console.log(`Budget clamp: request reduced to ${effectiveLimit} records.`);
  }

  if (dryRun) {
    console.log(`Dry run: sync is allowed for up to ${effectiveLimit} records; no permit query sent.`);
    return;
  }

  const query = await shovelsGet(apiKey, "/permits/search", {
    geo_id: geoId,
    permit_from: permitFrom,
    permit_to: permitTo,
    size: effectiveLimit,
    include_count: probe ? true : undefined,
    permit_tags: tags,
  });

  const items = Array.isArray(query.body?.items) ? query.body.items : [];
  const consumed = headerInt(query.response, "X-Credits-Request") ?? items.length;
  const remainingAfter = headerInt(query.response, "X-Credits-Remaining");

  if (probe) {
    console.log(`Probe complete. Matching permit count: ${JSON.stringify(query.body?.total_count ?? null)}`);
    console.log(`Records returned: ${items.length}`);
    if (items[0]) console.log(`Representative record:\n${JSON.stringify(publicPermit(items[0]), null, 2)}`);
    console.log(`Credits consumed: ${consumed}`);
    if (remainingAfter != null) console.log(`Credits remaining: ${remainingAfter}`);
    return;
  }

  const datasetArtifact = {
    updatedAt: new Date().toISOString(),
    query: {
      geoId,
      permitFrom,
      permitTo,
      tags,
      requestedSize: effectiveLimit,
    },
    permitCount: items.length,
    nextCursor: query.body?.next_cursor ?? null,
    permits: items.map(publicPermit),
  };

  const output = resolve("public", "data", "incidents", `${slug}.json`);
  const existing = await readExistingArtifact(output, slug);
  const existingDatasets = existing?.shovels?.datasets ?? {};
  const artifact = {
    ...(existing ?? {}),
    schemaVersion: 2,
    slug,
    updatedAt: new Date().toISOString(),
    shovels: {
      ...(existing?.shovels ?? {}),
      datasets: {
        ...existingDatasets,
        [dataset]: datasetArtifact,
      },
    },
  };

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  console.log(`Wrote ${items.length} sanitized ${dataset} permit records to ${output}`);
  console.log(`Credits consumed: ${consumed}`);
  if (remainingAfter != null) console.log(`Credits remaining: ${remainingAfter}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
