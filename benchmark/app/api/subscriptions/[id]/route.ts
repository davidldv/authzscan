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
