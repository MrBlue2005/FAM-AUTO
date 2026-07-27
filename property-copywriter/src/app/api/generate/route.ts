import { apiError, enforceRateLimit } from "@/lib/api";
import { requireStudioAuth } from "@/lib/studio-auth";
import { generateDescriptions } from "@/lib/openai-generator";
import { generateRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    await requireStudioAuth(request);
    enforceRateLimit(request, 8);
    const input = generateRequestSchema.parse(await request.json());
    return Response.json({ descriptions: await generateDescriptions(input.property, input.options, input.variant) });
  } catch (error) {
    return apiError(error);
  }
}
