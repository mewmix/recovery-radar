import { mkdir, writeFile } from "node:fs/promises";
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

function bodyRemaining(body) {
  if (!body || typeof body !== "object") return null;
  const candidates = [
    body.credits_remaining,
    body.remaining_credits,
    body.remaining,
    body.credit_remaining,
  ];
  for (const candidate of candidates) {
    if (Number.isFinite(candidate)) return Number(candidate);
  }
  return null;
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
    jobValue: permit?.job_value ?? null,
    contractorId: permit?.contractor_id ?? null,
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

async function main() {
  const apiKey = process.env.SHOVELS_API_KEY;
  if (!apiKey) throw new Error("SHOVELS_API_KEY is not set. Put it in .dev.vars.");

  const slug = required("slug");
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("--slug must contain only lowercase letters, numbers, and hyphens");

  const geoId = required("geo-id");
  const permitFrom = required("from");
  const permitTo = required("to");
  const requestedLimit = integer("limit", DEFAULT_LIMIT, 1, 100);
  const reserve = integer("reserve", DEFAULT_RESERVE, 0, 1000000);
  const tags = values("tag");
  const dryRun = process.argv.includes("--dry-run");

  const usage = await shovelsGet(apiKey, "/usage");
  const remaining = headerInt(usage.response, "X-Credits-Remaining") ?? bodyRemaining(usage.body);
  const limit = headerInt(usage.response, "X-Credits-Limit");

  if (remaining == null) {
    throw new Error("Could not verify remaining Shovels credits; refusing to ingest.");
  }

  const spendable = Math.max(0, remaining - reserve);
  const effectiveLimit = Math.min(requestedLimit, spendable);

  console.log(`Shovels credits: ${remaining}${limit == null ? "" : ` / ${limit}`} remaining`);
  console.log(`Protected reserve: ${reserve}`);
  console.log(`Requested records: ${requestedLimit}`);

  if (effectiveLimit < 1) {
    throw new Error(`Sync refused: ${remaining} credits remain and ${reserve} are reserved.`);
  }

  if (effectiveLimit < requestedLimit) {
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
    permit_tags: tags,
  });

  const items = Array.isArray(query.body?.items) ? query.body.items : [];
  const consumed = headerInt(query.response, "X-Credits-Request") ?? items.length;
  const remainingAfter = headerInt(query.response, "X-Credits-Remaining");

  const artifact = {
    schemaVersion: 1,
    slug,
    updatedAt: new Date().toISOString(),
    shovels: {
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
    },
  };

  const output = resolve("public", "data", "incidents", `${slug}.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  console.log(`Wrote ${items.length} sanitized permit records to ${output}`);
  console.log(`Credits consumed: ${consumed}`);
  if (remainingAfter != null) console.log(`Credits remaining: ${remainingAfter}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
