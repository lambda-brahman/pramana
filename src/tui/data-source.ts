import {
  addTenant as configAddTenant,
  removeTenant as configRemoveTenant,
  loadConfig,
} from "../config/index.ts";
import type { BuildReport } from "../engine/builder.ts";
import type { ArtifactView, ListFilter } from "../engine/reader.ts";
import { type TenantInfo, TenantManager } from "../engine/tenant.ts";
import { err, ok, type Result } from "../lib/result.ts";
import type { SearchResult } from "../storage/interface.ts";

export type DataSourceError = { type: "data-source"; message: string };

export type DataSource = {
  get(tenant: string, slug: string): Promise<Result<ArtifactView | null, DataSourceError>>;
  search(tenant: string, query: string): Promise<Result<SearchResult[], DataSourceError>>;
  traverse(
    tenant: string,
    from: string,
    relType?: string,
    depth?: number,
  ): Promise<Result<ArtifactView[], DataSourceError>>;
  list(tenant: string, filter?: ListFilter): Promise<Result<ArtifactView[], DataSourceError>>;
  listTenants(): Promise<Result<TenantInfo[], DataSourceError>>;
  reload(tenant: string): Promise<Result<BuildReport, DataSourceError>>;
  addKb(name: string, sourceDir: string): Promise<Result<void, DataSourceError>>;
  removeKb(name: string): Promise<Result<void, DataSourceError>>;
  mode: "daemon" | "standalone";
};

function dsErr(message: string): DataSourceError {
  return { type: "data-source", message };
}

export function createReaderDataSource(tm: TenantManager): DataSource {
  return {
    mode: "standalone",

    async get(tenant, slug) {
      const r = tm.getReader(tenant);
      if (!r.ok) return err(dsErr(r.error.message));
      const result = r.value.get(slug);
      if (!result.ok) return err(dsErr(result.error.message));
      return ok(result.value);
    },

    async search(tenant, query) {
      const r = tm.getReader(tenant);
      if (!r.ok) return err(dsErr(r.error.message));
      const result = await r.value.search(query);
      if (!result.ok) return err(dsErr(result.error.message));
      return ok(result.value);
    },

    async traverse(tenant, from, relType, depth) {
      const r = tm.getReader(tenant);
      if (!r.ok) return err(dsErr(r.error.message));
      const result = r.value.traverse(from, relType, depth);
      if (!result.ok) return err(dsErr(result.error.message));
      return ok(result.value);
    },

    async list(tenant, filter) {
      const r = tm.getReader(tenant);
      if (!r.ok) return err(dsErr(r.error.message));
      const result = r.value.list(filter);
      if (!result.ok) return err(dsErr(result.error.message));
      return ok(result.value);
    },

    async listTenants() {
      return ok(tm.listTenants());
    },

    async reload(tenant) {
      const result = await tm.reload(tenant);
      if (!result.ok) return err(dsErr(result.error.message));
      return ok(result.value);
    },

    async addKb(name, sourceDir) {
      const mountResult = await tm.mount({ name, sourceDir });
      if (!mountResult.ok) return err(dsErr(mountResult.error.message));
      const configResult = await configAddTenant(name, sourceDir);
      if (!configResult.ok) {
        tm.unmount(name);
        return err(dsErr(configResult.error.message));
      }
      return ok(undefined);
    },

    async removeKb(name) {
      const unmountResult = tm.unmount(name);
      if (!unmountResult.ok) return err(dsErr(unmountResult.error.message));
      const configResult = await configRemoveTenant(name);
      if (!configResult.ok) return err(dsErr(configResult.error.message));
      return ok(undefined);
    },
  };
}

export async function createStandaloneFromConfig(): Promise<Result<DataSource, DataSourceError>> {
  const tm = new TenantManager();
  await tm.initEmbedder();

  const configResult = await loadConfig();
  if (configResult.ok) {
    for (const [name, dir] of Object.entries(configResult.value.tenants)) {
      await tm.mount({ name, sourceDir: dir });
    }
  }

  return ok(createReaderDataSource(tm));
}

export function createHttpDataSource(port: string): DataSource {
  const baseUrl = `http://localhost:${port}`;

  async function fetchJson<T>(url: string, method = "GET"): Promise<Result<T, DataSourceError>> {
    try {
      const res = await fetch(url, { method });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        return err(dsErr(body.error ?? `HTTP ${res.status}`));
      }
      return ok((await res.json()) as T);
    } catch (e) {
      return err(dsErr(e instanceof Error ? e.message : "Network error"));
    }
  }

  return {
    mode: "daemon",

    async get(tenant, slug) {
      const parts = slug.split("#");
      const url =
        parts.length > 1
          ? `${baseUrl}/v1/${tenant}/get/${parts[0]}/${parts[1]}`
          : `${baseUrl}/v1/${tenant}/get/${slug}`;
      try {
        const res = await fetch(url);
        if (res.status === 404) return ok(null);
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          return err(dsErr(body.error ?? `HTTP ${res.status}`));
        }
        return ok((await res.json()) as ArtifactView);
      } catch (e) {
        return err(dsErr(e instanceof Error ? e.message : "Network error"));
      }
    },

    async search(tenant, query) {
      return fetchJson<SearchResult[]>(
        `${baseUrl}/v1/${tenant}/search?q=${encodeURIComponent(query)}`,
      );
    },

    async traverse(tenant, from, relType, depth) {
      const params = new URLSearchParams();
      if (relType) params.set("type", relType);
      if (depth !== undefined) params.set("depth", String(depth));
      return fetchJson<ArtifactView[]>(`${baseUrl}/v1/${tenant}/traverse/${from}?${params}`);
    },

    async list(tenant, filter) {
      const params = new URLSearchParams();
      if (filter?.tags?.length) params.set("tags", filter.tags.join(","));
      const qs = params.toString();
      return fetchJson<ArtifactView[]>(`${baseUrl}/v1/${tenant}/list${qs ? `?${qs}` : ""}`);
    },

    async listTenants() {
      return fetchJson<TenantInfo[]>(`${baseUrl}/v1/tenants`);
    },

    async reload(tenant) {
      const result = await fetchJson<{ status: string; report: BuildReport }>(
        `${baseUrl}/v1/${tenant}/reload`,
        "POST",
      );
      if (!result.ok) return result;
      return ok(result.value.report);
    },

    async addKb(name, sourceDir) {
      const configResult = await configAddTenant(name, sourceDir);
      if (!configResult.ok) return err(dsErr(configResult.error.message));
      return ok(undefined);
    },

    async removeKb(name) {
      const configResult = await configRemoveTenant(name);
      if (!configResult.ok) return err(dsErr(configResult.error.message));
      return ok(undefined);
    },
  };
}
