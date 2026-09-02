import { findCurrentFirePerimeter } from "./providers/wfigs";

interface Env {
  ASSETS: Fetcher;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function required(url: URL, name: string): string {
  const value = url.searchParams.get(name)?.trim();
  if (!value) throw new Error(`Missing query parameter: ${name}`);
  return value;
}

function incidentSlug(pathname: string): string | null {
  const match = pathname.match(/^\/api\/incidents\/([a-z0-9-]+)$/);
  return match?.[1] ?? null;
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

      const slug = incidentSlug(url.pathname);
      if (slug) {
        const assetUrl = new URL(`/data/incidents/${slug}.json`, url);
        const asset = await env.ASSETS.fetch(new Request(assetUrl, request));
        const contentType = asset.headers.get("content-type") ?? "";

        if (!asset.ok || !contentType.includes("application/json")) {
          return json({ error: "Incident snapshot not found" }, { status: 404 });
        }

        const headers = new Headers(asset.headers);
        headers.set("cache-control", "public, max-age=300, stale-while-revalidate=86400");
        return new Response(asset.body, { status: asset.status, headers });
      }

      return json({ error: "Not found" }, { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status = message.startsWith("Missing query parameter") ? 400 : 502;
      return json({ error: message }, { status });
    }
  },
};
