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
