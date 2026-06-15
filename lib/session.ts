import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readDb } from "./store";

const cookieName = "ca_session";

function secret() {
  return process.env.APP_SECRET || "dev-secret-change-me";
}

export function signSession(userId: string) {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token?: string) {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId: string; exp: number };
  if (decoded.exp < Date.now()) return null;
  return decoded.userId;
}

export function setSession(res: NextResponse, userId: string) {
  res.cookies.set(cookieName, signSession(userId), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
}

export function clearSession(res: NextResponse) {
  res.cookies.set(cookieName, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export async function currentUser() {
  const userId = verifySession(cookies().get(cookieName)?.value);
  if (!userId) return null;
  const db = await readDb();
  return db.users.find((user) => user.id === userId) || null;
}
