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
