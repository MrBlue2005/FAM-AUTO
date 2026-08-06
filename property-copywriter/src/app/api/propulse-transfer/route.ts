import { z } from "zod";
import { ApiHttpError, apiError } from "@/lib/api";
import { descriptionsSchema } from "@/lib/schemas";
import { requireStudioAuth } from "@/lib/studio-auth";

export const runtime = "nodejs";

const transferRequestSchema = z.object({
  descriptions: descriptionsSchema,
  sourceTitle: z.string().trim().max(4000).nullable().optional(),
  transactionType: z.enum(["rent", "sale"]).nullable().optional(),
});

const transferApiUrl = process.env.RX_PROPULSE_TRANSFER_URL
  || "http://127.0.0.1:3000/api/property-description-transfers";
const dashboardUrl = process.env.RX_DASHBOARD_URL || "http://127.0.0.1:5173/dashboard";

export async function POST(request: Request): Promise<Response> {
  try {
    await requireStudioAuth(request);
    const input = transferRequestSchema.parse(await request.json());
    const orderedDescriptions = [
      input.descriptions.commercial,
      input.descriptions.emotional,
      input.descriptions.premium,
    ].map((item) => ({ title: item.title, text: item.description }));

    const response = await fetch(transferApiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-rx-csrf": "1",
        cookie: request.headers.get("cookie") || "",
      },
      body: JSON.stringify({
        descriptions: orderedDescriptions,
        sourceTitle: input.sourceTitle,
        transactionType: input.transactionType,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json() as { id?: string; error?: string };
    if (!response.ok || !payload.id) {
      throw new ApiHttpError(response.status, payload.error || "Transferul nu a putut fi creat.");
    }

    const destination = new URL(dashboardUrl);
    destination.searchParams.set("page", "properties");
    destination.searchParams.set("descriptionTransfer", payload.id);
    return Response.json({ dashboardUrl: destination.href });
  } catch (error) {
    return apiError(error);
  }
}
