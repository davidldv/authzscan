"use server";

import { prisma } from "../../lib/prisma";
import { getServerSession } from "next-auth";

export async function updateProfile(userId: string, displayName: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("unauthorized");
  await prisma.user.update({ where: { id: userId }, data: { displayName } });
}
