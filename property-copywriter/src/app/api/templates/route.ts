import { ApiHttpError, apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { descriptionTemplateInputSchema } from "@/lib/schemas";
import { requireStudioAuth } from "@/lib/studio-auth";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStudioAuth(request);
    const templates = await prisma.descriptionTemplate.findMany({
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
    return Response.json({ templates });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireStudioAuth(request);
    const input = descriptionTemplateInputSchema.parse(await request.json());
    const duplicate = await prisma.descriptionTemplate.findUnique({ where: { name: input.name } });
    if (duplicate) throw new ApiHttpError(409, "Există deja un model cu acest nume.");

    const template = await prisma.$transaction(async (transaction) => {
      if (input.isDefault) await transaction.descriptionTemplate.updateMany({ data: { isDefault: false } });
      return transaction.descriptionTemplate.create({ data: input });
    });
    return Response.json({ template }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}