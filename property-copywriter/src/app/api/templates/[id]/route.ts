import { ApiHttpError, apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { descriptionTemplateInputSchema } from "@/lib/schemas";
import { requireStudioAuth } from "@/lib/studio-auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context): Promise<Response> {
  try {
    await requireStudioAuth(request);
    const { id } = await context.params;
    const input = descriptionTemplateInputSchema.parse(await request.json());
    const current = await prisma.descriptionTemplate.findUnique({ where: { id } });
    if (!current) throw new ApiHttpError(404, "Modelul nu a fost găsit.");
    const duplicate = await prisma.descriptionTemplate.findUnique({ where: { name: input.name } });
    if (duplicate && duplicate.id !== id) throw new ApiHttpError(409, "Există deja un model cu acest nume.");

    const template = await prisma.$transaction(async (transaction) => {
      if (input.isDefault) await transaction.descriptionTemplate.updateMany({ data: { isDefault: false } });
      return transaction.descriptionTemplate.update({ where: { id }, data: input });
    });
    return Response.json({ template });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    await requireStudioAuth(request);
    const { id } = await context.params;
    const current = await prisma.descriptionTemplate.findUnique({ where: { id } });
    if (!current) throw new ApiHttpError(404, "Modelul nu a fost găsit.");
    await prisma.descriptionTemplate.delete({ where: { id } });
    return Response.json({ success: true });
  } catch (error) {
    return apiError(error);
  }
}