import { prisma } from "../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function PATCH(req: Request) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const body = await req.json();
  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { displayName: body.displayName },
  });
  return Response.json(user);
}
