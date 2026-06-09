import type { TEndpoint } from "@authzscan/shared";

export interface EndpointGroup {
  key: string;
  endpoints: TEndpoint[];
}

function groupKey(e: TEndpoint): string {
  if (e.routePath !== null) {
    const segs = e.routePath.split("/").filter((s) => s !== "" && !s.startsWith("["));
    return segs.length === 0 ? "/" : `/${segs.join("/")}`;
  }
  const parts = e.file.replace(/\\/g, "/").split("/");
  return parts.slice(0, -1).join("/");
}

export function groupEndpoints(endpoints: TEndpoint[]): EndpointGroup[] {
  const relevant = endpoints.filter((e) => e.usesDb || e.params.length > 0);
  const byKey = new Map<string, TEndpoint[]>();
  for (const e of relevant) {
    const key = groupKey(e);
    const list = byKey.get(key) ?? [];
    list.push(e);
    byKey.set(key, list);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, eps]) => ({ key, endpoints: eps }));
}
