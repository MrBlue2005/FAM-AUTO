import { apiError, enforceRateLimit } from "@/lib/api";
import { requireStudioAuth } from "@/lib/studio-auth";
import { analyzeProperty } from "@/lib/extractor";
import { analyzeRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    await requireStudioAuth(request);
    enforceRateLimit(request, 6);
    const { url } = analyzeRequestSchema.parse(await request.json());
    return Response.json({ property: await analyzeProperty(url) });
  } catch (error) {
    return apiError(error);
  }
}
