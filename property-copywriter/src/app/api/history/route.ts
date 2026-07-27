import { apiError } from "@/lib/api";
import { requireStudioAuth } from "@/lib/studio-auth";
import { prisma } from "@/lib/prisma";
import { saveRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  try {
    await requireStudioAuth(request);
    const records = await prisma.propertyRecord.findMany({ orderBy: { updatedAt: "desc" } });
    return Response.json({ records });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireStudioAuth(request);
    const input = saveRequestSchema.parse(await request.json());
    const data = {
      sourceUrl: input.correctedData.sourceUrl,
      title: input.correctedData.title,
      extractedData: input.extractedData,
      correctedData: input.correctedData,
      generationOptions: input.options,
      descriptions: input.descriptions,
    };
    const record = input.id
      ? await prisma.propertyRecord.update({ where: { id: input.id }, data })
      : await prisma.propertyRecord.create({ data });
    return Response.json({ record });
  } catch (error) { return apiError(error); }
}
