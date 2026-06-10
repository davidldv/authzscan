import { prisma } from "../../../../lib/prisma";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const doc = await prisma.document.findUnique({ where: { id: params.id } });
  return Response.json(doc);
}
