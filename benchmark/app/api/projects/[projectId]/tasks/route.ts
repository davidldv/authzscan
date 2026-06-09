import { prisma } from "../../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(_req: Request, { params }: { params: { projectId: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const tasks = await prisma.task.findMany({ where: { projectId: params.projectId } });
  return Response.json(tasks);
}
