import { prisma } from "../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const invoices = await prisma.invoice.findMany({
    where: { userId: session.user.id },
  });
  return Response.json(invoices);
}
