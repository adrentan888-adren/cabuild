import { NextRequest, NextResponse } from "next/server";

const PUBLIC_FILE = /\.(.*)$/;

function surface() {
  return process.env.APP_SURFACE || "combined";
}

function isPagePath(pathname: string) {
  return !pathname.startsWith("/api") && !pathname.startsWith("/_next") && !PUBLIC_FILE.test(pathname);
}

export function middleware(req: NextRequest) {
  const mode = surface();
  const { pathname } = req.nextUrl;

  if (mode === "combined") {
    if (pathname === '/admin' || pathname.startsWith('/admin/')) return NextResponse.redirect(new URL('/?view=settings',req.url));
    return NextResponse.next();
  }

  if (mode === "api") {
    if (pathname.startsWith("/api")) {
      if (req.method === "OPTIONS") return withCors(req, new NextResponse(null, { status: 204 }));
      return withCors(req, NextResponse.next());
    }
    if (pathname === "/healthz") return NextResponse.json({ ok: true, surface: "api" });
    return NextResponse.json({ error: "API service only" }, { status: 404 });
  }

  if ((mode === "frontend" || mode === "admin") && pathname.startsWith("/api")) {
    const apiUrl = process.env.API_SERVICE_URL;
    if (apiUrl) {
      const target = new URL(`${pathname}${req.nextUrl.search}`, apiUrl);
      return NextResponse.rewrite(target);
    }
  }

  if (mode === "frontend") {
    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
      return NextResponse.redirect(new URL('/?view=settings',req.url));
    }
    return NextResponse.next();
  }

  if (mode === "admin") {
    if (isPagePath(pathname)) return NextResponse.redirect(new URL('/?view=settings',process.env.FRONTEND_SERVICE_URL || 'https://contentagent-social-mkhae4sjlq-as.a.run.app'));
  }

  return NextResponse.next();
}

function withCors(req: NextRequest, res: NextResponse) {
  const allowed = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const origin = req.headers.get("origin");
  if (origin && allowed.includes(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Credentials", "true");
    res.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    res.headers.set("Vary", "Origin");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
