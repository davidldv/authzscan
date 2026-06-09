import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const body = await req.json();
  const address = await prisma.address.update({ where: { id: params.id }, data: body });
  return Response.json(address);
}
