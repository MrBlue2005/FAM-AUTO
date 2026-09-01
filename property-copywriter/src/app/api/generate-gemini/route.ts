import { apiError, enforceRateLimit } from "@/lib/api";
import { generateGeminiDescriptions } from "@/lib/gemini-generator";
import { generateRequestSchema } from "@/lib/schemas";
import { requireStudioAuth } from "@/lib/studio-auth";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    await requireStudioAuth(request);
    enforceRateLimit(request, 6);
    const input = generateRequestSchema.parse(await request.json());
    const descriptions = await generateGeminiDescriptions(input.property, input.options, input.variant);
    return Response.json({ descriptions });
  } catch (error) {
    return apiError(error);
  }
}
