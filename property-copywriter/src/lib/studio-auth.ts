import { ApiHttpError } from "@/lib/api";

const authStatusUrl = process.env.RX_AUTH_STATUS_URL || "http://127.0.0.1:3000/api/auth/status";

export async function requireStudioAuth(request: Request): Promise<void> {
  const method = request.method.toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && request.headers.get("x-rx-csrf") !== "1") {
    throw new ApiHttpError(403, "Cererea nu a trecut verificarea CSRF.");
  }

  let response: Response;
  try {
    response = await fetch(authStatusUrl, {
      cache: "no-store",
      headers: { cookie: request.headers.get("cookie") || "" },
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    throw new ApiHttpError(503, "Serviciul de autentificare nu este disponibil.");
  }

  if (!response.ok) throw new ApiHttpError(503, "Serviciul de autentificare nu este disponibil.");
  const status = await response.json() as { enabled?: boolean; authenticated?: boolean };
  if (status.enabled && !status.authenticated) throw new ApiHttpError(401, "Autentificare necesară.");
}