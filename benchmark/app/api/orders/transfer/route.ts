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
