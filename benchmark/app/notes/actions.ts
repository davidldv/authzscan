"use server";

import { prisma } from "../../lib/prisma";
import { getServerSession } from "next-auth";

export async function deleteNote(id: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("unauthorized");
  await prisma.note.deleteMany({ where: { id, userId: session.user.id } });
}
