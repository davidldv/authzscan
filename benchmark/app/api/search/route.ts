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
