import { apiError } from "@/lib/api";
import { requireStudioAuth } from "@/lib/studio-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    await requireStudioAuth(request);
    const { id } = await context.params;
    const record = await prisma.propertyRecord.findUnique({ where: { id } });
    if (!record) return Response.json({ error: "Înregistrarea nu a fost găsită." }, { status: 404 });
    return Response.json({ record });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    await requireStudioAuth(request);
    const { id } = await context.params;
    await prisma.propertyRecord.delete({ where: { id } });
    return Response.json({ success: true });
  } catch (error) { return apiError(error); }
}
