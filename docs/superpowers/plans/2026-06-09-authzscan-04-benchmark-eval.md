# authzscan Plan 04: Benchmark + Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deliberately-vulnerable benchmark Next.js app (16 seeded IDOR variants + 6 hardened twins, manifest as ground truth) and `@authzscan/eval` — the harness that scans it, scores recall/precision/cost, aggregates multi-run mean+variance, and renders committed eval reports. Quality gates: **≥80% recall, ≥70% precision**.

**Architecture:** `benchmark/` lives at repo root (NOT under `packages/*` — vitest/tsc never touch it; it is scan *input*, not workspace code). Ground truth lives only in `benchmark/vulns.json`; **benchmark source contains zero vuln markers** — the agent greps the repo during scans, so any in-code label leaks the answer key. `@authzscan/eval` is pure logic (manifest schema, finding classifier, metrics, aggregation, report renderer) + a CLI that runs `executeScan` N times. A `PerfectRunner` fake replays the manifest as flawless findings — it exercises the entire harness for free and must score recall 1.0 / precision 1.0 (harness sanity gate). Live Fable runs are manual and cost money; CI never calls the API.

**Tech Stack:** existing workspace + commander (eval CLI). No new external deps.

**Plan series:** 01 foundation → 02 inventory → 03 engine + CLI (all merged) → **04 benchmark + eval (this, final MVP plan)**.

**Spec:** `docs/superpowers/specs/2026-06-09-authzscan-mvp-design.md`

---

## Benchmark design (read before Task 1)

16 vulns — easy 6 / medium 6 / hard 4 — one vulnerable file each, plus 6 hardened twin files (false-positive tripwires). Auth idiom: `getServerSession()` from next-auth, prisma client from `lib/prisma`. **No comments referencing vulns, V-ids, or "intentionally insecure" anywhere in `benchmark/` source.** Gate check for recall: ≥13/16 vulns; precision: confirmed findings citing clean or unknown files count against it.

| ID | Difficulty | File | Pattern |
|---|---|---|---|
| V1 | easy | `app/api/orders/[id]/route.ts` | GET fetch-by-id, session checked but no ownership scope |
| V2 | easy | `app/api/documents/[id]/route.ts` | GET fetch-by-id, no auth at all |
| V3 | easy | `app/api/comments/[id]/route.ts` | DELETE by id, no check |
| V4 | easy | `app/api/addresses/[id]/route.ts` | PUT update by id, no check |
| V5 | easy | `app/cards/actions.ts` | server action `deleteCard(id)`, no check |
| V6 | easy | `app/api/attachments/[id]/route.ts` | GET attachment row by id, no check |
| V7 | medium | `app/api/invoices/[id]/route.ts` | GET checks ownership; DELETE in same file does not |
| V8 | medium | `app/profile/actions.ts` | `updateProfile(userId, ...)` — session fetched but target userId comes from args |
| V9 | medium | `app/api/projects/[projectId]/tasks/route.ts` | task list filtered only by client-supplied projectId (missing tenancy) |
| V10 | medium | `app/api/orders/transfer/route.ts` | POST body `{orderId}`, order fetched/mutated unchecked |
| V11 | medium | `app/reports/actions.ts` | `exportReport(reportId)` — session existence checked, ownership not |
| V12 | medium | `app/api/subscriptions/[id]/route.ts` | PATCH mutates first, ownership "check" after the write |
| V13 | hard | `app/api/orders/[id]/invoice/route.ts` | indirect: invoice reached via unchecked order relation |
| V14 | hard | `app/api/search/route.ts` | `$queryRawUnsafe` with client-supplied account filter |
| V15 | hard | `app/documents/actions.ts` | `shareDocument(docId, email)` — ownership checked against wrong subject (recipient, not caller) |
| V16 | hard | `app/api/teams/[teamId]/members/route.ts` | membership "check" not scoped to caller (`findFirst({ where: { teamId } })`) |

Hardened twins (clean files): `app/api/notes/[id]/route.ts` (findFirst id+userId), `app/api/cards/[id]/route.ts` (DELETE with prior ownership check), `app/notes/actions.ts` (scoped delete), `app/api/projects/[projectId]/route.ts` (membership check then fetch), `app/api/profile/route.ts` (operates only on session user), `app/api/invoices/route.ts` (list scoped by userId).

---

### Task 1: Benchmark scaffold + easy vulns (V1–V6) + first hardened twins

**Files:**
- Create: `benchmark/package.json`
- Create: `benchmark/lib/prisma.ts`
- Create: `benchmark/prisma/schema.prisma`
- Create: `benchmark/app/api/orders/[id]/route.ts` (V1)
- Create: `benchmark/app/api/documents/[id]/route.ts` (V2)
- Create: `benchmark/app/api/comments/[id]/route.ts` (V3)
- Create: `benchmark/app/api/addresses/[id]/route.ts` (V4)
- Create: `benchmark/app/cards/actions.ts` (V5)
- Create: `benchmark/app/api/attachments/[id]/route.ts` (V6)
- Create: `benchmark/app/api/notes/[id]/route.ts` (clean H1)
- Create: `benchmark/app/api/cards/[id]/route.ts` (clean H2)
- Create: `benchmark/vulns.json` (started)

- [ ] **Step 1: Write scaffold files**

`benchmark/package.json`:
```json
{
  "name": "authzscan-benchmark",
  "private": true,
  "dependencies": {
    "next": "^15.0.0",
    "next-auth": "^5.0.0",
    "@prisma/client": "^6.0.0"
  }
}
```

`benchmark/lib/prisma.ts`:
```ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
```

`benchmark/prisma/schema.prisma`:
```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model User {
  id    String @id @default(cuid())
  email String @unique
}

model Order {
  id     String @id @default(cuid())
  userId String
}

model Invoice {
  id      String @id @default(cuid())
  userId  String
  orderId String
}

model Document {
  id      String @id @default(cuid())
  ownerId String
}

model Note {
  id     String @id @default(cuid())
  userId String
}
```

- [ ] **Step 2: Write the easy vulnerable routes (no vuln markers in code!)**

`benchmark/app/api/orders/[id]/route.ts` (V1):
```ts
import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const order = await prisma.order.findUnique({ where: { id: params.id } });
  if (!order) return new Response("not found", { status: 404 });
  return Response.json(order);
}
```

`benchmark/app/api/documents/[id]/route.ts` (V2):
```ts
import { prisma } from "../../../../lib/prisma";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const doc = await prisma.document.findUnique({ where: { id: params.id } });
  return Response.json(doc);
}
```

`benchmark/app/api/comments/[id]/route.ts` (V3):
```ts
import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  await prisma.comment.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
}
```

`benchmark/app/api/addresses/[id]/route.ts` (V4):
```ts
import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const body = await req.json();
  const address = await prisma.address.update({ where: { id: params.id }, data: body });
  return Response.json(address);
}
```

`benchmark/app/cards/actions.ts` (V5):
```ts
"use server";

import { prisma } from "../../lib/prisma";
import { getServerSession } from "next-auth";

export async function deleteCard(id: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("unauthorized");
  await prisma.card.delete({ where: { id } });
}
```

`benchmark/app/api/attachments/[id]/route.ts` (V6):
```ts
import { prisma } from "../../../../lib/prisma";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const attachment = await prisma.attachment.findUnique({ where: { id: params.id } });
  if (!attachment) return new Response("not found", { status: 404 });
  return Response.json(attachment);
}
```

- [ ] **Step 3: Write the hardened twins**

`benchmark/app/api/notes/[id]/route.ts` (clean):
```ts
import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const note = await prisma.note.findFirst({
    where: { id: params.id, userId: session.user.id },
  });
  if (!note) return new Response("not found", { status: 404 });
  return Response.json(note);
}
```

`benchmark/app/api/cards/[id]/route.ts` (clean):
```ts
import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const card = await prisma.card.findFirst({
    where: { id: params.id, userId: session.user.id },
  });
  if (!card) return new Response("not found", { status: 404 });
  await prisma.card.delete({ where: { id: card.id } });
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Start the manifest**

`benchmark/vulns.json`:
```json
{
  "vulns": [
    { "id": "V1", "file": "app/api/orders/[id]/route.ts", "type": "direct-fetch", "difficulty": "easy", "description": "GET fetches order by client id; session checked but query not scoped to user" },
    { "id": "V2", "file": "app/api/documents/[id]/route.ts", "type": "direct-fetch", "difficulty": "easy", "description": "GET fetches document by id with no auth at all" },
    { "id": "V3", "file": "app/api/comments/[id]/route.ts", "type": "unchecked-mutation", "difficulty": "easy", "description": "DELETE removes comment by client id without ownership check" },
    { "id": "V4", "file": "app/api/addresses/[id]/route.ts", "type": "unchecked-mutation", "difficulty": "easy", "description": "PUT updates address by client id without ownership check" },
    { "id": "V5", "file": "app/cards/actions.ts", "type": "unchecked-action", "difficulty": "easy", "description": "deleteCard server action deletes by client id without ownership check" },
    { "id": "V6", "file": "app/api/attachments/[id]/route.ts", "type": "direct-fetch", "difficulty": "easy", "description": "GET fetches attachment by id with no auth" }
  ],
  "cleanFiles": [
    "app/api/notes/[id]/route.ts",
    "app/api/cards/[id]/route.ts"
  ]
}
```

- [ ] **Step 5: Verify the batch parses (inventory finds the endpoints)**

Run from repo root:
```bash
pnpm exec tsx -e "import { runInventory } from './packages/inventory/src/index.js'; const r = runInventory('benchmark'); console.log(r.endpoints.length, 'endpoints,', r.skippedFiles.length, 'skipped'); if (r.skippedFiles.length) { console.error(r.skippedFiles); process.exit(1); }"
```
Expected: `8 endpoints, 0 skipped` (V1 GET, V2 GET, V3 DELETE, V4 PUT, V5 action, V6 GET, H1 GET, H2 DELETE).

- [ ] **Step 6: Commit**

```bash
git add benchmark
git commit -m "feat(benchmark): scaffold vulnerable app with easy IDOR batch (V1-V6)"
```

---

### Task 2: Medium vulns (V7–V12) + hardened twins H3–H4

**Files:**
- Create: `benchmark/app/api/invoices/[id]/route.ts` (V7)
- Create: `benchmark/app/profile/actions.ts` (V8)
- Create: `benchmark/app/api/projects/[projectId]/tasks/route.ts` (V9)
- Create: `benchmark/app/api/orders/transfer/route.ts` (V10)
- Create: `benchmark/app/reports/actions.ts` (V11)
- Create: `benchmark/app/api/subscriptions/[id]/route.ts` (V12)
- Create: `benchmark/app/notes/actions.ts` (clean H3)
- Create: `benchmark/app/api/projects/[projectId]/route.ts` (clean H4)
- Modify: `benchmark/vulns.json`

- [ ] **Step 1: Write the medium vulnerable files**

`benchmark/app/api/invoices/[id]/route.ts` (V7 — GET safe, DELETE vulnerable):
```ts
import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, userId: session.user.id },
  });
  if (!invoice) return new Response("not found", { status: 404 });
  return Response.json(invoice);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  await prisma.invoice.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
}
```

`benchmark/app/profile/actions.ts` (V8):
```ts
"use server";

import { prisma } from "../../lib/prisma";
import { getServerSession } from "next-auth";

export async function updateProfile(userId: string, displayName: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("unauthorized");
  await prisma.user.update({ where: { id: userId }, data: { displayName } });
}
```

`benchmark/app/api/projects/[projectId]/tasks/route.ts` (V9):
```ts
import { prisma } from "../../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(_req: Request, { params }: { params: { projectId: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const tasks = await prisma.task.findMany({ where: { projectId: params.projectId } });
  return Response.json(tasks);
}
```

`benchmark/app/api/orders/transfer/route.ts` (V10):
```ts
import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const { orderId, toUserId } = await req.json();
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { userId: toUserId },
  });
  return Response.json(order);
}
```

`benchmark/app/reports/actions.ts` (V11):
```ts
"use server";

import { prisma } from "../../lib/prisma";
import { getServerSession } from "next-auth";

export async function exportReport(reportId: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("unauthorized");
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) throw new Error("not found");
  return { url: `/exports/${report.id}.csv` };
}
```

`benchmark/app/api/subscriptions/[id]/route.ts` (V12 — check after write):
```ts
import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const body = await req.json();
  const subscription = await prisma.subscription.update({
    where: { id: params.id },
    data: { plan: body.plan },
  });
  if (subscription.userId !== session.user.id) {
    console.warn("subscription updated by non-owner", params.id);
  }
  return Response.json(subscription);
}
```

- [ ] **Step 2: Write the hardened twins**

`benchmark/app/notes/actions.ts` (clean):
```ts
"use server";

import { prisma } from "../../lib/prisma";
import { getServerSession } from "next-auth";

export async function deleteNote(id: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("unauthorized");
  await prisma.note.deleteMany({ where: { id, userId: session.user.id } });
}
```

`benchmark/app/api/projects/[projectId]/route.ts` (clean):
```ts
import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(_req: Request, { params }: { params: { projectId: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const membership = await prisma.membership.findFirst({
    where: { projectId: params.projectId, userId: session.user.id },
  });
  if (!membership) return new Response("forbidden", { status: 403 });
  const project = await prisma.project.findUnique({ where: { id: params.projectId } });
  return Response.json(project);
}
```

- [ ] **Step 3: Extend the manifest**

Append to `benchmark/vulns.json` `vulns` array:
```json
{ "id": "V7", "file": "app/api/invoices/[id]/route.ts", "type": "method-asymmetry", "difficulty": "medium", "description": "GET scoped to user; DELETE in same file deletes by raw client id" },
{ "id": "V8", "file": "app/profile/actions.ts", "type": "wrong-subject", "difficulty": "medium", "description": "updateProfile mutates the userId passed by the client, not the session user" },
{ "id": "V9", "file": "app/api/projects/[projectId]/tasks/route.ts", "type": "missing-tenancy", "difficulty": "medium", "description": "task list filtered only by client projectId; no membership check" },
{ "id": "V10", "file": "app/api/orders/transfer/route.ts", "type": "unchecked-mutation", "difficulty": "medium", "description": "POST transfers order ownership using body orderId without verifying caller owns it" },
{ "id": "V11", "file": "app/reports/actions.ts", "type": "unchecked-action", "difficulty": "medium", "description": "exportReport checks session exists but never report ownership" },
{ "id": "V12", "file": "app/api/subscriptions/[id]/route.ts", "type": "check-after-write", "difficulty": "medium", "description": "PATCH mutates subscription before the ownership comparison; check only logs" }
```
Append to `cleanFiles`:
```json
"app/notes/actions.ts",
"app/api/projects/[projectId]/route.ts"
```

- [ ] **Step 4: Verify the batch parses**

Run the same inventory one-liner as Task 1 Step 5.
Expected: `17 endpoints, 0 skipped` (8 prior + V7 GET+DELETE, V8 action, V9 GET, V10 POST, V11 action, V12 PATCH, H3 action, H4 GET).

- [ ] **Step 5: Commit**

```bash
git add benchmark
git commit -m "feat(benchmark): add medium IDOR batch (V7-V12)"
```

---

### Task 3: Hard vulns (V13–V16) + hardened twins H5–H6, manifest complete

**Files:**
- Create: `benchmark/app/api/orders/[id]/invoice/route.ts` (V13)
- Create: `benchmark/app/api/search/route.ts` (V14)
- Create: `benchmark/app/documents/actions.ts` (V15)
- Create: `benchmark/app/api/teams/[teamId]/members/route.ts` (V16)
- Create: `benchmark/app/api/profile/route.ts` (clean H5)
- Create: `benchmark/app/api/invoices/route.ts` (clean H6)
- Modify: `benchmark/vulns.json`

- [ ] **Step 1: Write the hard vulnerable files**

`benchmark/app/api/orders/[id]/invoice/route.ts` (V13 — indirect reference):
```ts
import { prisma } from "../../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const invoice = await prisma.invoice.findFirst({ where: { orderId: params.id } });
  if (!invoice) return new Response("not found", { status: 404 });
  return Response.json(invoice);
}
```

`benchmark/app/api/search/route.ts` (V14 — raw SQL, client-controlled account filter):
```ts
import { prisma } from "../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const accountId = url.searchParams.get("accountId") ?? "";
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM Order_ WHERE accountId = '${accountId}' AND title LIKE '%${q}%'`,
  );
  return Response.json(rows);
}
```

`benchmark/app/documents/actions.ts` (V15 — ownership checked against wrong subject):
```ts
"use server";

import { prisma } from "../../lib/prisma";
import { getServerSession } from "next-auth";

export async function shareDocument(docId: string, recipientEmail: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("unauthorized");
  const recipient = await prisma.user.findUnique({ where: { email: recipientEmail } });
  if (!recipient) throw new Error("recipient not found");
  const doc = await prisma.document.findFirst({
    where: { id: docId, ownerId: recipient.id },
  });
  if (!doc) {
    await prisma.share.create({ data: { documentId: docId, userId: recipient.id } });
  }
  return { shared: true };
}
```

`benchmark/app/api/teams/[teamId]/members/route.ts` (V16 — check not scoped to caller):
```ts
import { prisma } from "../../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(_req: Request, { params }: { params: { teamId: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const membership = await prisma.membership.findFirst({ where: { teamId: params.teamId } });
  if (!membership) return new Response("forbidden", { status: 403 });
  const members = await prisma.membership.findMany({ where: { teamId: params.teamId } });
  return Response.json(members);
}
```

- [ ] **Step 2: Write the hardened twins**

`benchmark/app/api/profile/route.ts` (clean — only session subject):
```ts
import { prisma } from "../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function PATCH(req: Request) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const body = await req.json();
  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { displayName: body.displayName },
  });
  return Response.json(user);
}
```

`benchmark/app/api/invoices/route.ts` (clean — list scoped):
```ts
import { prisma } from "../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const invoices = await prisma.invoice.findMany({
    where: { userId: session.user.id },
  });
  return Response.json(invoices);
}
```

- [ ] **Step 3: Complete the manifest**

Append to `vulns`:
```json
{ "id": "V13", "file": "app/api/orders/[id]/invoice/route.ts", "type": "indirect-reference", "difficulty": "hard", "description": "invoice fetched via order id relation; order ownership never verified" },
{ "id": "V14", "file": "app/api/search/route.ts", "type": "raw-sql-tenancy", "difficulty": "hard", "description": "$queryRawUnsafe filters by client-supplied accountId (and is injectable)" },
{ "id": "V15", "file": "app/documents/actions.ts", "type": "wrong-subject-check", "difficulty": "hard", "description": "shareDocument checks ownership against the recipient, not the caller; any doc can be shared" },
{ "id": "V16", "file": "app/api/teams/[teamId]/members/route.ts", "type": "unscoped-check", "difficulty": "hard", "description": "membership lookup omits userId — any existing team passes the check for any caller" }
```
Append to `cleanFiles`:
```json
"app/api/profile/route.ts",
"app/api/invoices/route.ts"
```

- [ ] **Step 4: Verify final benchmark parses**

Run the inventory one-liner.
Expected: `23 endpoints, 0 skipped` (17 prior + V13 GET, V14 GET, V15 action, V16 GET, H5 PATCH, H6 GET).

- [ ] **Step 5: Grep for label leakage (must be empty)**

Run: `pnpm exec tsx -e "import { grepRepo } from './packages/engine/src/index.js'; const hits = grepRepo('benchmark', 'VULN|vuln|V1[0-6]?\\\\b|intentional|insecure'); console.log(JSON.stringify(hits)); process.exit(hits.length === 0 ? 0 : 1);"`
Expected: `[]`, exit 0. The agent must not be able to grep the answer key.

- [ ] **Step 6: Commit**

```bash
git add benchmark
git commit -m "feat(benchmark): add hard IDOR batch (V13-V16), manifest complete"
```

---

### Task 4: Eval package — manifest schema + benchmark consistency test

**Files:**
- Create: `packages/eval/package.json`
- Create: `packages/eval/tsconfig.json`
- Create: `packages/eval/src/manifest.ts`
- Create: `packages/eval/src/index.ts`
- Test: `packages/eval/test/manifest.test.ts`

- [ ] **Step 1: Create package scaffold**

`packages/eval/package.json`:
```json
{
  "name": "@authzscan/eval",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@authzscan/engine": "workspace:*",
    "@authzscan/inventory": "workspace:*",
    "@authzscan/shared": "workspace:*",
    "commander": "^14.0.0",
    "zod": "^4.0.0"
  }
}
```

`packages/eval/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/eval/test/manifest.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "../src/index.js";
import { runInventory } from "@authzscan/inventory";

const benchmarkDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "benchmark");

describe("loadManifest", () => {
  it("loads and validates the real benchmark manifest", () => {
    const m = loadManifest(benchmarkDir);
    expect(m.vulns).toHaveLength(16);
    expect(m.cleanFiles).toHaveLength(6);
    expect(m.vulns.filter((v) => v.difficulty === "easy")).toHaveLength(6);
    expect(m.vulns.filter((v) => v.difficulty === "medium")).toHaveLength(6);
    expect(m.vulns.filter((v) => v.difficulty === "hard")).toHaveLength(4);
  });

  it("throws on a missing manifest", () => {
    expect(() => loadManifest("/nonexistent")).toThrow(/vulns\.json/);
  });
});

describe("benchmark consistency (manifest ↔ inventory ground truth)", () => {
  const inventory = runInventory(benchmarkDir);
  const endpointFiles = new Set(inventory.endpoints.map((e) => e.file));

  it("inventory parses the whole benchmark with nothing skipped", () => {
    expect(inventory.skippedFiles).toEqual([]);
  });

  it("every seeded vuln file is a discovered endpoint file", () => {
    const m = loadManifest(benchmarkDir);
    for (const v of m.vulns) {
      expect(endpointFiles, `vuln ${v.id} file not in inventory`).toContain(v.file);
    }
  });

  it("every clean file is a discovered endpoint file", () => {
    const m = loadManifest(benchmarkDir);
    for (const f of m.cleanFiles) {
      expect(endpointFiles, `clean file ${f} not in inventory`).toContain(f);
    }
  });

  it("vuln files and clean files do not overlap", () => {
    const m = loadManifest(benchmarkDir);
    const vulnFiles = new Set(m.vulns.map((v) => v.file));
    for (const f of m.cleanFiles) expect(vulnFiles).not.toContain(f);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/eval/test/manifest.test.ts`
Expected: FAIL — cannot resolve `../src/index.js`.

- [ ] **Step 4: Write minimal implementation**

`packages/eval/src/manifest.ts`:
```ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const Vuln = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  type: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  description: z.string().min(1),
});

export const Manifest = z.object({
  vulns: z.array(Vuln).min(1),
  cleanFiles: z.array(z.string()),
});

export type TVuln = z.infer<typeof Vuln>;
export type TManifest = z.infer<typeof Manifest>;

export function loadManifest(benchmarkDir: string): TManifest {
  const p = path.join(benchmarkDir, "vulns.json");
  if (!existsSync(p)) throw new Error(`manifest not found: ${p} (expected vulns.json in benchmark dir)`);
  return Manifest.parse(JSON.parse(readFileSync(p, "utf8")));
}
```

`packages/eval/src/index.ts`:
```ts
export * from "./manifest.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/eval/test/manifest.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/eval pnpm-lock.yaml
git commit -m "feat(eval): add manifest schema and benchmark consistency tests"
```

---

### Task 5: Classifier + metrics

**Files:**
- Create: `packages/eval/src/classify.ts`
- Modify: `packages/eval/src/index.ts`
- Test: `packages/eval/test/classify.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/eval/test/classify.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { classifyFindings, computeMetrics } from "../src/index.js";
import type { TManifest } from "../src/index.js";
import type { TFinding } from "@authzscan/shared";

const manifest: TManifest = {
  vulns: [
    { id: "V1", file: "app/a.ts", type: "t", difficulty: "easy", description: "d" },
    { id: "V2", file: "app/b.ts", type: "t", difficulty: "medium", description: "d" },
    { id: "V3", file: "app/c.ts", type: "t", difficulty: "hard", description: "d" },
  ],
  cleanFiles: ["app/clean.ts"],
};

function finding(id: string, file: string, verdict: "confirmed" | "rejected" = "confirmed"): TFinding {
  return {
    id,
    endpointId: "ep",
    title: "t",
    description: "d",
    evidence: [{ file, startLine: 1, endLine: 2, note: "n" }],
    verdict,
    confidence: "high",
    reproduction: "r",
    suggestedFix: "s",
  };
}

describe("classifyFindings", () => {
  it("classifies TP (vuln file), FP (clean file), unknown (other file); ignores rejected", () => {
    const c = classifyFindings(
      [
        finding("f1", "app/a.ts"),
        finding("f2", "app/clean.ts"),
        finding("f3", "app/mystery.ts"),
        finding("f4", "app/b.ts", "rejected"),
      ],
      manifest,
    );
    expect(c.matchedVulnIds).toEqual(["V1"]);
    expect(c.truePositives.map((f) => f.id)).toEqual(["f1"]);
    expect(c.falsePositives.map((f) => f.id)).toEqual(["f2"]);
    expect(c.unknowns.map((f) => f.id)).toEqual(["f3"]);
  });

  it("credits a vuln only once for multiple findings on the same file", () => {
    const c = classifyFindings([finding("f1", "app/a.ts"), finding("f2", "app/a.ts")], manifest);
    expect(c.matchedVulnIds).toEqual(["V1"]);
    expect(c.truePositives).toHaveLength(2);
  });
});

describe("computeMetrics", () => {
  it("computes recall, precision (unknowns count against), per-difficulty recall", () => {
    const c = classifyFindings(
      [finding("f1", "app/a.ts"), finding("f2", "app/b.ts"), finding("f3", "app/mystery.ts")],
      manifest,
    );
    const m = computeMetrics(c, manifest);
    expect(m.recall).toBeCloseTo(2 / 3, 5);
    expect(m.precision).toBeCloseTo(2 / 3, 5); // 2 TP / (2 TP + 0 FP + 1 unknown)
    expect(m.perDifficulty).toEqual({
      easy: { found: 1, total: 1 },
      medium: { found: 1, total: 1 },
      hard: { found: 0, total: 1 },
    });
  });

  it("handles zero confirmed findings (precision 1, recall 0)", () => {
    const c = classifyFindings([], manifest);
    const m = computeMetrics(c, manifest);
    expect(m.recall).toBe(0);
    expect(m.precision).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/eval/test/classify.test.ts`
Expected: FAIL — `classifyFindings` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/eval/src/classify.ts`:
```ts
import type { TFinding } from "@authzscan/shared";
import type { TManifest } from "./manifest.js";

export interface Classification {
  matchedVulnIds: string[];
  truePositives: TFinding[];
  falsePositives: TFinding[];
  unknowns: TFinding[];
}

export function classifyFindings(findings: TFinding[], manifest: TManifest): Classification {
  const vulnByFile = new Map(manifest.vulns.map((v) => [v.file, v]));
  const clean = new Set(manifest.cleanFiles);
  const matched = new Set<string>();
  const truePositives: TFinding[] = [];
  const falsePositives: TFinding[] = [];
  const unknowns: TFinding[] = [];

  for (const f of findings) {
    if (f.verdict !== "confirmed") continue;
    const files = f.evidence.map((e) => e.file);
    const vuln = files.map((file) => vulnByFile.get(file)).find((v) => v !== undefined);
    if (vuln) {
      matched.add(vuln.id);
      truePositives.push(f);
    } else if (files.some((file) => clean.has(file))) {
      falsePositives.push(f);
    } else {
      unknowns.push(f);
    }
  }

  const order = manifest.vulns.map((v) => v.id);
  return {
    matchedVulnIds: order.filter((id) => matched.has(id)),
    truePositives,
    falsePositives,
    unknowns,
  };
}

export interface Metrics {
  recall: number;
  precision: number;
  perDifficulty: Record<"easy" | "medium" | "hard", { found: number; total: number }>;
}

export function computeMetrics(c: Classification, manifest: TManifest): Metrics {
  const matched = new Set(c.matchedVulnIds);
  const perDifficulty = { easy: { found: 0, total: 0 }, medium: { found: 0, total: 0 }, hard: { found: 0, total: 0 } };
  for (const v of manifest.vulns) {
    perDifficulty[v.difficulty].total++;
    if (matched.has(v.id)) perDifficulty[v.difficulty].found++;
  }
  const recall = manifest.vulns.length === 0 ? 1 : matched.size / manifest.vulns.length;
  // Controlled benchmark: anything that isn't a seeded vuln is a wrong finding,
  // so unknowns count against precision alongside clean-file hits.
  const denominator = c.truePositives.length + c.falsePositives.length + c.unknowns.length;
  const precision = denominator === 0 ? 1 : c.truePositives.length / denominator;
  return { recall, precision, perDifficulty };
}
```

`packages/eval/src/index.ts`:
```ts
export * from "./manifest.js";
export * from "./classify.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/eval/test/classify.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/eval
git commit -m "feat(eval): add finding classifier and recall/precision metrics"
```

---

### Task 6: Multi-run aggregation + report renderer

**Files:**
- Create: `packages/eval/src/aggregate.ts`
- Create: `packages/eval/src/report.ts`
- Modify: `packages/eval/src/index.ts`
- Test: `packages/eval/test/aggregate.test.ts`
- Test: `packages/eval/test/report.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/eval/test/aggregate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { aggregateRuns } from "../src/index.js";
import type { RunOutcome } from "../src/index.js";

function run(recall: number, precision: number, costUsd: number): RunOutcome {
  return {
    metrics: {
      recall,
      precision,
      perDifficulty: { easy: { found: 0, total: 0 }, medium: { found: 0, total: 0 }, hard: { found: 0, total: 0 } },
    },
    classification: { matchedVulnIds: [], truePositives: [], falsePositives: [], unknowns: [] },
    costUsd,
    durationMs: 1000,
  };
}

describe("aggregateRuns", () => {
  it("computes mean and sample stddev across runs", () => {
    const agg = aggregateRuns([run(0.8, 0.7, 1), run(0.9, 0.8, 3), run(1.0, 0.9, 2)]);
    expect(agg.recall.mean).toBeCloseTo(0.9, 5);
    expect(agg.recall.stddev).toBeCloseTo(0.1, 5);
    expect(agg.precision.mean).toBeCloseTo(0.8, 5);
    expect(agg.costUsd.mean).toBeCloseTo(2, 5);
  });

  it("stddev is 0 for a single run", () => {
    const agg = aggregateRuns([run(0.8, 0.7, 1)]);
    expect(agg.recall.stddev).toBe(0);
  });
});
```

`packages/eval/test/report.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderEvalReport } from "../src/index.js";
import type { RunOutcome } from "../src/index.js";

const outcome: RunOutcome = {
  metrics: {
    recall: 0.875,
    precision: 0.78,
    perDifficulty: { easy: { found: 6, total: 6 }, medium: { found: 5, total: 6 }, hard: { found: 3, total: 4 } },
  },
  classification: { matchedVulnIds: ["V1", "V2"], truePositives: [], falsePositives: [], unknowns: [] },
  costUsd: 2.34,
  durationMs: 90_000,
};

describe("renderEvalReport", () => {
  const md = renderEvalReport({
    model: "claude-fable-5",
    generatedAt: "2026-06-09T12:00:00Z",
    runs: [outcome, outcome],
    gates: { recall: 0.8, precision: 0.7 },
  });

  it("is a stable snapshot", () => {
    expect(md).toMatchSnapshot();
  });

  it("states gate results explicitly", () => {
    expect(md).toContain("recall gate (>=80%): PASS");
    expect(md).toContain("precision gate (>=70%): PASS");
  });

  it("fails gates when below threshold", () => {
    const bad = renderEvalReport({
      model: "claude-fable-5",
      generatedAt: "2026-06-09T12:00:00Z",
      runs: [{ ...outcome, metrics: { ...outcome.metrics, recall: 0.5, precision: 0.5 } }],
      gates: { recall: 0.8, precision: 0.7 },
    });
    expect(bad).toContain("recall gate (>=80%): FAIL");
    expect(bad).toContain("precision gate (>=70%): FAIL");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/eval/test/aggregate.test.ts packages/eval/test/report.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Write minimal implementation**

`packages/eval/src/aggregate.ts`:
```ts
import type { Classification, Metrics } from "./classify.js";

export interface RunOutcome {
  metrics: Metrics;
  classification: Classification;
  costUsd: number;
  durationMs: number;
}

export interface Stat {
  mean: number;
  stddev: number;
}

function stat(values: number[]): Stat {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, stddev: 0 };
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { mean, stddev: Math.sqrt(variance) };
}

export interface Aggregate {
  recall: Stat;
  precision: Stat;
  costUsd: Stat;
  durationMs: Stat;
}

export function aggregateRuns(runs: RunOutcome[]): Aggregate {
  return {
    recall: stat(runs.map((r) => r.metrics.recall)),
    precision: stat(runs.map((r) => r.metrics.precision)),
    costUsd: stat(runs.map((r) => r.costUsd)),
    durationMs: stat(runs.map((r) => r.durationMs)),
  };
}
```

`packages/eval/src/report.ts`:
```ts
import { aggregateRuns, type RunOutcome } from "./aggregate.js";

export interface EvalReportInput {
  model: string;
  generatedAt: string;
  runs: RunOutcome[];
  gates: { recall: number; precision: number };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function renderEvalReport(input: EvalReportInput): string {
  const agg = aggregateRuns(input.runs);
  const recallPass = agg.recall.mean >= input.gates.recall;
  const precisionPass = agg.precision.mean >= input.gates.precision;

  const lines: string[] = [
    "# authzscan eval report",
    "",
    `- **Model:** ${input.model}`,
    `- **Generated:** ${input.generatedAt}`,
    `- **Runs:** ${input.runs.length}`,
    "",
    "## Aggregate",
    "",
    `- Recall: ${pct(agg.recall.mean)} (±${pct(agg.recall.stddev)})`,
    `- Precision: ${pct(agg.precision.mean)} (±${pct(agg.precision.stddev)})`,
    `- Cost per scan: $${agg.costUsd.mean.toFixed(2)} (±$${agg.costUsd.stddev.toFixed(2)})`,
    `- Duration per scan: ${(agg.durationMs.mean / 1000).toFixed(0)}s`,
    "",
    "## Gates",
    "",
    `- recall gate (>=${pct(input.gates.recall).replace(".0%", "%")}): ${recallPass ? "PASS" : "FAIL"}`,
    `- precision gate (>=${pct(input.gates.precision).replace(".0%", "%")}): ${precisionPass ? "PASS" : "FAIL"}`,
    "",
    "## Per run",
    "",
    "| run | recall | precision | TP | FP | unknown | matched vulns | cost |",
    "|---|---|---|---|---|---|---|---|",
  ];

  input.runs.forEach((r, i) => {
    const d = r.metrics.perDifficulty;
    lines.push(
      `| ${i + 1} | ${pct(r.metrics.recall)} | ${pct(r.metrics.precision)} | ${r.classification.truePositives.length} | ${r.classification.falsePositives.length} | ${r.classification.unknowns.length} | ${r.classification.matchedVulnIds.join(" ") || "-"} | $${r.costUsd.toFixed(2)} |`,
    );
    lines.push(
      `| | easy ${d.easy.found}/${d.easy.total} | medium ${d.medium.found}/${d.medium.total} | hard ${d.hard.found}/${d.hard.total} | | | | |`,
    );
  });

  lines.push("");
  return lines.join("\n");
}
```

`packages/eval/src/index.ts`:
```ts
export * from "./manifest.js";
export * from "./classify.js";
export * from "./aggregate.js";
export * from "./report.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/eval/test/aggregate.test.ts packages/eval/test/report.test.ts`
Expected: PASS (2 + 3 tests, 1 snapshot).

- [ ] **Step 5: Commit**

```bash
git add packages/eval
git commit -m "feat(eval): add multi-run aggregation and eval report renderer"
```

---

### Task 7: PerfectRunner + runEval orchestration (free full-harness test)

**Files:**
- Create: `packages/eval/src/perfect-runner.ts`
- Create: `packages/eval/src/run-eval.ts`
- Modify: `packages/eval/src/index.ts`
- Test: `packages/eval/test/run-eval.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/eval/test/run-eval.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { runInventory } from "@authzscan/inventory";
import { loadManifest, PerfectRunner, runEval } from "../src/index.js";

const benchmarkSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "benchmark");

describe("runEval with PerfectRunner (harness sanity gate)", () => {
  it("scores recall 1.0 and precision 1.0 on the benchmark", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "authzscan-eval-"));
    cpSync(benchmarkSrc, dir, { recursive: true });
    try {
      const manifest = loadManifest(dir);
      const inventory = runInventory(dir);
      const outcome = await runEval({
        benchmarkDir: dir,
        manifest,
        runs: 2,
        model: "claude-fable-5",
        makeRunner: () => new PerfectRunner(manifest, inventory.endpoints),
      });
      expect(outcome.runs).toHaveLength(2);
      for (const r of outcome.runs) {
        expect(r.metrics.recall).toBe(1);
        expect(r.metrics.precision).toBe(1);
        expect(r.classification.matchedVulnIds).toHaveLength(16);
      }
      expect(outcome.report).toContain("recall gate (>=80%): PASS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/eval/test/run-eval.test.ts`
Expected: FAIL — `PerfectRunner` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/eval/src/perfect-runner.ts`:
```ts
import type { AgentRunner, AgentRunRequest, AgentRunResult } from "@authzscan/engine";
import type { TEndpoint } from "@authzscan/shared";
import type { TManifest } from "./manifest.js";

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

// Replays the manifest as flawless agent output. Exercises the entire scan
// pipeline (grouping, prompts, extraction, artifacts, rendering) for free.
// A harness that doesn't score 1.0/1.0 with this runner is broken.
export class PerfectRunner implements AgentRunner {
  constructor(
    private readonly manifest: TManifest,
    private readonly endpoints: TEndpoint[],
  ) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (request.prompt.includes("adversarially verifying")) {
      return {
        text: JSON.stringify({
          verdict: "confirmed",
          confidence: "high",
          reproduction: "perfect-runner replay",
          suggestedFix: "scope the query to the session user",
        }),
        usage: ZERO_USAGE,
      };
    }

    const vulnFiles = new Set(this.manifest.vulns.map((v) => v.file));
    const candidates = this.endpoints
      .filter((e) => vulnFiles.has(e.file) && request.prompt.includes(JSON.stringify(e.file).slice(1, -1)))
      .map((e) => ({
        id: `perfect_${e.id}`,
        endpointId: e.id,
        title: `IDOR in ${e.file}`,
        description: "seeded vulnerability (perfect-runner replay)",
        evidence: [{ file: e.file, startLine: 1, endLine: 5, note: "manifest ground truth" }],
      }));

    // One candidate per file is enough to credit the vuln; dedupe by file.
    const seen = new Set<string>();
    const deduped = candidates.filter((c) => {
      const file = c.evidence[0].file;
      if (seen.has(file)) return false;
      seen.add(file);
      return true;
    });
    return { text: JSON.stringify(deduped), usage: ZERO_USAGE };
  }
}
```

`packages/eval/src/run-eval.ts`:
```ts
import { rmSync } from "node:fs";
import path from "node:path";
import { executeScan, type AgentRunner } from "@authzscan/engine";
import { classifyFindings, computeMetrics } from "./classify.js";
import { renderEvalReport } from "./report.js";
import type { RunOutcome } from "./aggregate.js";
import type { TManifest } from "./manifest.js";

export const GATES = { recall: 0.8, precision: 0.7 };

export interface EvalOptions {
  benchmarkDir: string;
  manifest: TManifest;
  runs: number;
  model: string;
  makeRunner: () => AgentRunner;
  budgetUsd?: number;
  log?: (message: string) => void;
}

export interface EvalOutcome {
  runs: RunOutcome[];
  report: string;
  gatesPassed: boolean;
}

export async function runEval(opts: EvalOptions): Promise<EvalOutcome> {
  const runs: RunOutcome[] = [];

  for (let i = 0; i < opts.runs; i++) {
    // Fresh scan every run — stale artifacts would make later runs free and fake.
    rmSync(path.join(opts.benchmarkDir, ".authzscan"), { recursive: true, force: true });
    const started = Date.now();
    const result = await executeScan({
      repoPath: opts.benchmarkDir,
      runner: opts.makeRunner(),
      model: opts.model,
      retry: { retries: 2, delayMs: 1000 },
      budgetUsd: opts.budgetUsd,
      log: opts.log,
    });
    const classification = classifyFindings(result.findings, opts.manifest);
    const metrics = computeMetrics(classification, opts.manifest);
    runs.push({ metrics, classification, costUsd: result.spentUsd, durationMs: Date.now() - started });
    opts.log?.(`run ${i + 1}/${opts.runs}: recall ${metrics.recall.toFixed(2)} precision ${metrics.precision.toFixed(2)} $${result.spentUsd.toFixed(2)}`);
  }

  const report = renderEvalReport({
    model: opts.model,
    generatedAt: new Date().toISOString(),
    runs,
    gates: GATES,
  });
  const meanRecall = runs.reduce((a, r) => a + r.metrics.recall, 0) / runs.length;
  const meanPrecision = runs.reduce((a, r) => a + r.metrics.precision, 0) / runs.length;
  return { runs, report, gatesPassed: meanRecall >= GATES.recall && meanPrecision >= GATES.precision };
}
```

`packages/eval/src/index.ts`:
```ts
export * from "./manifest.js";
export * from "./classify.js";
export * from "./aggregate.js";
export * from "./report.js";
export * from "./perfect-runner.js";
export * from "./run-eval.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/eval/test/run-eval.test.ts`
Expected: PASS (1 test — slow, runs the real pipeline twice on the benchmark with the fake runner).

- [ ] **Step 5: Commit**

```bash
git add packages/eval
git commit -m "feat(eval): add PerfectRunner sanity gate and runEval orchestration"
```

---

### Task 8: Eval CLI + repo wiring + full verification

**Files:**
- Create: `packages/eval/src/bin.ts`
- Create: `eval-reports/.gitkeep`
- Modify: root `package.json` (eval script)
- Modify: `.gitignore` (NOT ignoring eval-reports)

- [ ] **Step 1: Write the CLI**

`packages/eval/src/bin.ts`:
```ts
#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Command, Option } from "commander";
import { AnthropicRunner } from "@authzscan/engine";
import { runInventory } from "@authzscan/inventory";
import { loadManifest } from "./manifest.js";
import { PerfectRunner } from "./perfect-runner.js";
import { runEval } from "./run-eval.js";

const program = new Command();
program
  .name("authzscan-eval")
  .argument("[benchmark]", "path to benchmark dir", "benchmark")
  .option("--runs <n>", "number of scan runs", (v) => Number(v), 3)
  .option("--model <id>", "Anthropic model id", "claude-fable-5")
  .option("--budget <usd>", "per-run budget in USD", (v) => Number(v))
  .addOption(new Option("--fake", "use PerfectRunner (free harness check, no API calls)").default(false))
  .action(async (benchmark: string, opts: { runs: number; model: string; budget?: number; fake: boolean }) => {
    const manifest = loadManifest(benchmark);
    const makeRunner = opts.fake
      ? () => new PerfectRunner(manifest, runInventory(benchmark).endpoints)
      : () => new AnthropicRunner({ model: opts.model });

    if (!opts.fake) {
      console.error(`LIVE eval: ${opts.runs} run(s) on ${opts.model} — this costs real money.`);
    }

    const outcome = await runEval({
      benchmarkDir: benchmark,
      manifest,
      runs: opts.runs,
      model: opts.fake ? `${opts.model} (fake)` : opts.model,
      makeRunner,
      budgetUsd: opts.budget,
      log: (m) => console.error(`[eval] ${m}`),
    });

    mkdirSync("eval-reports", { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join("eval-reports", `${stamp}${opts.fake ? "-fake" : ""}.md`);
    writeFileSync(file, outcome.report, "utf8");
    console.log(outcome.report);
    console.error(`written: ${file}`);
    process.exit(outcome.gatesPassed ? 0 : 1);
  });

program.parse();
```

`eval-reports/.gitkeep`: empty file. Eval reports are committed — tuning history in git is writeup material.

Root `package.json` — add to `scripts`:
```json
"eval": "tsx packages/eval/src/bin.ts",
"eval:fake": "tsx packages/eval/src/bin.ts --fake --runs 1"
```

- [ ] **Step 2: Run the fake eval end-to-end**

Run: `pnpm eval:fake`
Expected: report printed, recall 100.0%, precision 100.0%, both gates PASS, exit 0, file written under `eval-reports/` with `-fake` suffix.

- [ ] **Step 3: Full-suite verification**

Run: `pnpm test` then `pnpm typecheck`
Expected: all green (114 prior + eval ~14 ≈ 128), typecheck clean (benchmark/ excluded by being outside `packages/*`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(eval): add eval CLI with fake mode and committed report output"
```

- [ ] **Step 5: Live eval (manual, costs real money — the headline numbers)**

NOT CI. With `ANTHROPIC_API_KEY` set:
```bash
pnpm eval --runs 3 --budget 10
```
Expected: 3 live Fable 5 scans of the benchmark, report committed to `eval-reports/`, gates evaluated. **v1 is "done" per spec when mean recall ≥80% and precision ≥70%.** If gates fail: tune prompts (`packages/engine/src/prompts.ts` — snapshot tests make drift visible), re-run, commit each report. Tuning history in git = writeup gold.

---

## Spec coverage map (Plan 04 slice)

| Spec requirement | Task |
|---|---|
| Benchmark app, 15–20 seeded IDOR variants, tagged manifest | 1–3 (16 vulns) |
| Variants incl. direct fetch, tenancy, GET/DELETE asymmetry, action-vs-UI, indirect leak | 1–3 |
| Hardened twins as FP tripwires | 1–3 (6 clean files) |
| `pnpm eval` runs full scan, diffs vs manifest | 7, 8 |
| Metrics: recall, precision, per-difficulty, cost, wall time | 5, 6 |
| Eval runs 3×, mean + variance | 6, 8 |
| Eval reports committed (tuning history in git) | 8 |
| Quality gates ≥80% recall / ≥70% precision | 6, 7, 8 |
| Non-determinism honest reporting | 6 |

Additions beyond spec (justified): PerfectRunner harness sanity gate (proves the measuring stick before paying for live runs); label-leakage grep check (Task 3 Step 5 — benchmark code must not contain the answer key, since trace agents grep the repo).

**Spec item NOT in this plan — real-world pass.** Scanning `labodega`, `paircode`, `securepay` and manually triaging findings (spec §Real-world pass) is post-gate manual work, not a TDD task: once eval gates pass, run `authzscan scan <repo> --budget N` per repo, triage, fix anything real, anonymize for the writeup. No plan needed — it's usage of the shipped tool.
