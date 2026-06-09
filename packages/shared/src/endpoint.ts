import { z } from "zod";

export const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export const Endpoint = z.object({
  id: z.string().min(1),
  kind: z.enum(["route-handler", "server-action"]),
  file: z.string().min(1),
  method: HttpMethod.nullable(),
  routePath: z.string().nullable(),
  params: z.array(z.string()),
  usesDb: z.boolean(),
  authIndicators: z.array(z.string()),
});

export const AuthProfile = z.object({
  library: z.enum(["next-auth", "clerk", "lucia", "custom", "unknown"]),
  sessionAccessPatterns: z.array(z.string()),
  ownershipIdioms: z.array(z.string()),
});

export const InventoryResult = z.object({
  endpoints: z.array(Endpoint),
  authProfile: AuthProfile,
  skippedFiles: z.array(z.object({ file: z.string(), reason: z.string() })),
});

export type THttpMethod = z.infer<typeof HttpMethod>;
export type TEndpoint = z.infer<typeof Endpoint>;
export type TAuthProfile = z.infer<typeof AuthProfile>;
export type TInventoryResult = z.infer<typeof InventoryResult>;
