import type { SourceFile } from "ts-morph";
import type { THttpMethod } from "@authzscan/shared";

const HTTP_METHODS: readonly string[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export interface ExtractedHandler {
  exportName: string;
  method: THttpMethod;
}

export function extractRouteHandlers(sf: SourceFile): ExtractedHandler[] {
  const out: Array<ExtractedHandler & { pos: number }> = [];
  for (const [name, decls] of sf.getExportedDeclarations()) {
    if (HTTP_METHODS.includes(name)) {
      const pos = decls[0]?.getStart() ?? 0;
      out.push({ exportName: name, method: name as THttpMethod, pos });
    }
  }
  return out
    .sort((a, b) => a.pos - b.pos)
    .map(({ exportName, method }) => ({ exportName, method }));
}
