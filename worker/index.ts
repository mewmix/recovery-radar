import { findCurrentFirePerimeter } from "./providers/wfigs";
import { searchPermits } from "./providers/shovels";

interface Env {
  SHOVELS_API_KEY: string;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function required(url: URL, name: string): string {
  const value = url.searchParams.get(name)?.trim();
  if (!value) throw new Error(`Missing query parameter: ${name}`);
  return value;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "recovery-radar" });
      }

      if (url.pathname === "/api/fire/perimeter") {
        const name = required(url, "name");
        const perimeter = await findCurrentFirePerimeter(name);
        return perimeter
          ? json(perimeter, { headers: { "cache-control": "public, max-age=300" } })
          : json({ error: "No current perimeter found" }, { status: 404 });
      }

      if (url.pathname === "/api/shovels/permits") {
        const result = await searchPermits(env, {
          geoId: required(url, "geo_id"),
          permitFrom: required(url, "from"),
          permitTo: required(url, "to"),
          cursor: url.searchParams.get("cursor") ?? undefined,
          includeCount: url.searchParams.get("include_count") === "true",
          tags: url.searchParams.getAll("tag"),
        });
        return json(result);
      }

      return json({ error: "Not found" }, { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status = message.startsWith("Missing query parameter") ? 400 : 502;
      return json({ error: message }, { status });
    }
  },
};
