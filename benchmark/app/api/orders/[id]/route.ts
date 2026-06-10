import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const order = await prisma.order.findUnique({ where: { id: params.id } });
  if (!order) return new Response("not found", { status: 404 });
  return Response.json(order);
}
