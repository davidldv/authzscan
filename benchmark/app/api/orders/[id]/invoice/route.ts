import { prisma } from "../../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const invoice = await prisma.invoice.findFirst({ where: { orderId: params.id } });
  if (!invoice) return new Response("not found", { status: 404 });
  return Response.json(invoice);
}
