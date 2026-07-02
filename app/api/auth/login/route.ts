import { NextResponse } from "next/server";
import { readDb, verifyPassword } from "@/lib/store";
import { setSession } from "@/lib/session";

export async function POST(req: Request) {
  const { email, password } = await req.json();
  const db = await readDb();
  const user = db.users.find((item) => item.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !verifyPassword(String(password), user.passwordHash)) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  if (user.emailVerified === false) {
    return NextResponse.json({ error: "Please verify your email before signing in.", verificationRequired: true, email: user.email }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  setSession(res, user.id);
  return res;
}
