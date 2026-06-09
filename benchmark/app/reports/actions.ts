"use server";

import { prisma } from "../../lib/prisma";
import { getServerSession } from "next-auth";

export async function exportReport(reportId: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("unauthorized");
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) throw new Error("not found");
  return { url: `/exports/${report.id}.csv` };
}
