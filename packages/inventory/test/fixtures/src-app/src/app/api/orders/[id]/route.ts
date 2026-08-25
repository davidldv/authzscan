import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  const order = await prisma.order.findUnique({ where: { id: params.id } });
  return Response.json(order);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await prisma.order.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
}
