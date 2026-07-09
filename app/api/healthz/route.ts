import { NextResponse } from "next/server";
import { mutateDb, readDb, verifyPassword } from "@/lib/store";

export const dynamic = "force-dynamic";

const diagnosticToken = "phase7-deep-health-20260709";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("deep") === "1") {
    if (process.env.POSTGRES_STATE_ID !== "staging" || req.headers.get("x-ca-diagnostic") !== diagnosticToken) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    try {
      const db = await readDb();
      const demo = db.users.find((user) => String(user.email || "").toLowerCase() === "demo@contentagent.tech");
      const mutation = await mutateDb((draft) => ({
        users: draft.users.length,
        workspaces: draft.workspaces.length,
        billingLedger: draft.billingLedger?.length || 0
      }));
      return NextResponse.json({
        ok: true,
        surface: process.env.APP_SURFACE || "combined",
        deep: {
          read: { users: db.users.length, workspaces: db.workspaces.length, billingLedger: db.billingLedger?.length || 0 },
          mutate: mutation,
          auth: {
            demoFound: Boolean(demo),
            demoRole: demo?.role || null,
            demoDisabled: Boolean(demo?.disabledAt),
            demoEmailVerified: demo?.emailVerified !== false,
            demoPasswordType: typeof demo?.passwordHash,
            demoPasswordValid: demo ? verifyPassword("demo1234", demo.passwordHash) : false
          }
        }
      });
    } catch (error) {
      return NextResponse.json({
        ok: false,
        surface: process.env.APP_SURFACE || "combined",
        error: errorMessage(error)
      }, { status: 500 });
    }
  }
  return NextResponse.json({
    ok: true,
    surface: process.env.APP_SURFACE || "combined"
  });
}
