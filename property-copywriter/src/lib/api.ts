import { ZodError } from "zod";

export class ApiHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiHttpError";
  }
}

export function apiError(error: unknown): Response {
  if (error instanceof ApiHttpError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) {
    return Response.json({ error: "Datele trimise nu sunt valide.", details: error.issues }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "A apărut o eroare neașteptată.";
  const safe = /executable doesn't exist|browser.*not found|playwright install/i.test(message)
    ? "Browserul local necesar analizei nu este instalat. Rulează „npx playwright install chromium” în aplicația generatorului."
    : /api[_ -]?key|secret|password/i.test(message)
      ? "Serviciul extern nu este configurat corect."
      : message;
  return Response.json({ error: safe }, { status: 400 });
}

const buckets = new Map<string, number[]>();
export function enforceRateLimit(request: Request, limit = 8, windowMs = 60_000): void {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) throw new Error("Prea multe cereri. Așteaptă un minut și încearcă din nou.");
  recent.push(now);
  buckets.set(key, recent);
}
