"use server";

import { prisma } from "../../lib/prisma";
import { getServerSession } from "next-auth";

export async function deleteCard(id: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("unauthorized");
  await prisma.card.delete({ where: { id } });
}
