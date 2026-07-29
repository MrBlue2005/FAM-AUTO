import { NextRequest, NextResponse } from "next/server";

const authStatusUrl = process.env.RX_AUTH_STATUS_URL || "http://127.0.0.1:3000/api/auth/status";
const loginUrl = process.env.RX_LOGIN_URL || "http://127.0.0.1:5173/";
const copywriterUrl = process.env.RX_COPYWRITER_URL || "http://127.0.0.1:3100";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  try {
    const response = await fetch(authStatusUrl, {
      cache: "no-store",
      headers: { cookie: request.headers.get("cookie") || "" },
      signal: AbortSignal.timeout(3_000),
    });
    if (response.ok) {
      const status = await response.json() as { enabled?: boolean; authenticated?: boolean };
      if (!status.enabled || status.authenticated) return NextResponse.next();
    }
  } catch {
    // Fail closed below if the authentication service cannot be reached.
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Autentificare necesară." }, { status: 401 });
  }

  const destination = new URL(loginUrl);
  const returnTo = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, copywriterUrl);
  destination.searchParams.set("returnTo", returnTo.href);
  return NextResponse.redirect(destination);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};