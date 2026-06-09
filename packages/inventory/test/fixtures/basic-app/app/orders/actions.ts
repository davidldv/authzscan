"use server";

import { prisma } from "../../lib/prisma";
import { getServerSession } from "next-auth";

export async function deleteOrder(id: string) {
  const session = await getServerSession();
  await prisma.order.delete({ where: { id, userId: session.user.id } });
}
