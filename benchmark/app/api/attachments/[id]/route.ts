import { prisma } from "../../../../lib/prisma";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const attachment = await prisma.attachment.findUnique({ where: { id: params.id } });
  if (!attachment) return new Response("not found", { status: 404 });
  return Response.json(attachment);
}
