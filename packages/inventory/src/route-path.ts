export interface RoutePathInfo {
  routePath: string;
  params: string[];
}

function paramName(segment: string): string | null {
  const m = segment.match(/^\[{1,2}(?:\.\.\.)?([^\].]+)\]{1,2}$/);
  return m ? m[1] : null;
}

export function routePathFromFile(file: string): RoutePathInfo | null {
  const norm = file.replace(/\\/g, "/");
  const m = norm.match(/^app\/(?:(.*)\/)?route\.(ts|tsx|js|jsx)$/);
  if (!m) return null;

  const dir = m[1] ?? "";
  const segments = dir === "" ? [] : dir.split("/");
  const visible = segments.filter(
    (s) => !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("@"),
  );

  const params: string[] = [];
  for (const seg of visible) {
    const p = paramName(seg);
    if (p !== null) params.push(p);
  }

  return {
    routePath: visible.length === 0 ? "/" : `/${visible.join("/")}`,
    params,
  };
}
