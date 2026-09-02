import { countMontereyBuildingsInPerimeter } from "./providers/montereyBuildings";
import { findCurrentFirePerimeter } from "./providers/wfigs";
import {
  getRecoveryState,
  recoveryDatasetFromState,
  runScheduledRecoverySync,
  type KVNamespaceBinding,
} from "./scheduledRecovery";

interface AssetBinding {
  fetch(input: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetBinding;
  RECOVERY_STATE: KVNamespaceBinding;
  SHOVELS_API_KEY?: string;
}

interface ScheduledControllerLike {
  scheduledTime: number;
  cron: string;
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

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function incidentArtifact(env: Env, requestUrl: URL, slug: string): Promise<Response> {
  const assetUrl = new URL(`/data/incidents/${slug}.json`, requestUrl);
  const asset = await env.ASSETS.fetch(new Request(assetUrl.toString()));
  const contentType = asset.headers.get("content-type") ?? "";

  if (!asset.ok || !contentType.includes("application/json")) {
    return json({ error: "Incident snapshot not found" }, { status: 404 });
  }

  const artifact = await asset.json();
  if (!isRecord(artifact)) return json({ error: "Incident snapshot invalid" }, { status: 502 });

  const recoveryState = await getRecoveryState(env, slug);
  if (recoveryState) {
    const shovels = isRecord(artifact.shovels) ? artifact.shovels : {};
    const datasets = isRecord(shovels.datasets) ? shovels.datasets : {};
    artifact.shovels = {
      ...shovels,
      datasets: {
        ...datasets,
        recovery: recoveryDatasetFromState(recoveryState),
      },
    };
    artifact.liveUpdatedAt = recoveryState.updatedAt;
  }

  return json(artifact, {
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health") {
        return json({
          ok: true,
          service: "recovery-radar",
          recoverySync: {
            mode: "scheduled_incremental",
            cron: "15 15 * * *",
            maxRecordsPerRun: 5,
            reserveCredits: 100,
          },
        });
      }

      if (url.pathname === "/api/fire/perimeter") {
        const name = required(url, "name");
        const perimeter = await findCurrentFirePerimeter(name);
        return perimeter
          ? json(perimeter, { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=1800" } })
          : json({ error: "No current perimeter found" }, { status: 404 });
      }

      if (url.pathname === "/api/impact/buildings") {
        const name = required(url, "name");
        const perimeter = await findCurrentFirePerimeter(name);
        if (!perimeter) return json({ error: "No current perimeter found" }, { status: 404 });

        const exposure = await countMontereyBuildingsInPerimeter(perimeter.geometry);
        return json(
          {
            incident: {
              id: perimeter.id,
              name: perimeter.name,
              perimeterUpdatedAt: perimeter.perimeterUpdatedAt ?? null,
            },
            exposure,
          },
          { headers: { "cache-control": "public, max-age=3600, stale-while-revalidate=21600" } },
        );
      }

      const slug = incidentSlug(url.pathname);
      if (slug) return incidentArtifact(env, url, slug);

      return json({ error: "Not found" }, { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status = message.startsWith("Missing query parameter") ? 400 : 502;
      return json({ error: message }, { status });
    }
  },

  async scheduled(controller: ScheduledControllerLike, env: Env): Promise<void> {
    await runScheduledRecoverySync(env, controller.scheduledTime);
  },
};
