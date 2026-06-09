import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT, buildTracePrompt, buildVerifyPrompt } from "../src/index.js";
import type { TEndpoint, TAuthProfile, TCandidateFinding } from "@authzscan/shared";

const endpoint: TEndpoint = {
  id: "ep_orders",
  kind: "route-handler",
  file: "app/api/orders/[id]/route.ts",
  method: "GET",
  routePath: "/api/orders/[id]",
  params: ["id"],
  usesDb: true,
  authIndicators: ["getServerSession"],
};

const profile: TAuthProfile = {
  library: "next-auth",
  sessionAccessPatterns: ["getServerSession"],
  ownershipIdioms: ["{ id, userId: session.user.id }"],
};

const candidate: TCandidateFinding = {
  id: "f1",
  endpointId: "ep_orders",
  title: "t",
  description: "d",
  evidence: [{ file: "app/api/orders/[id]/route.ts", startLine: 1, endLine: 2, note: "n" }],
};

describe("prompts", () => {
  it("system prompt frames work as defensive code review", () => {
    expect(SYSTEM_PROMPT).toMatch(/defensive code review/i);
    expect(SYSTEM_PROMPT).not.toMatch(/exploit develop/i);
  });

  it("trace prompt is a stable snapshot", () => {
    expect(buildTracePrompt({ groupKey: "/api/orders", endpoints: [endpoint], authProfile: profile })).toMatchSnapshot();
  });

  it("verify prompt is a stable snapshot", () => {
    expect(buildVerifyPrompt({ candidate, authProfile: profile })).toMatchSnapshot();
  });

  it("trace prompt embeds endpoint data and repo auth idioms", () => {
    const p = buildTracePrompt({ groupKey: "/api/orders", endpoints: [endpoint], authProfile: profile });
    expect(p).toContain("app/api/orders/[id]/route.ts");
    expect(p).toContain("userId: session.user.id");
  });
});
