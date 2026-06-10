"use server";

import { prisma } from "../../lib/prisma";
import { getServerSession } from "next-auth";

export async function shareDocument(docId: string, recipientEmail: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("unauthorized");
  const recipient = await prisma.user.findUnique({ where: { email: recipientEmail } });
  if (!recipient) throw new Error("recipient not found");
  const doc = await prisma.document.findFirst({
    where: { id: docId, ownerId: recipient.id },
  });
  if (!doc) {
    await prisma.share.create({ data: { documentId: docId, userId: recipient.id } });
  }
  return { shared: true };
}
