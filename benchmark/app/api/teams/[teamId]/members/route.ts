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
