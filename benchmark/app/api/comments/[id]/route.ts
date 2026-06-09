import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  await prisma.comment.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
}
