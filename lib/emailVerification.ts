import crypto from "crypto";

function secret() {
  return process.env.APP_SECRET || "dev-secret-change-me";
}

export function createVerificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

export function hashVerificationCode(code: string) {
  return crypto.createHmac("sha256", secret()).update(code.trim()).digest("hex");
}

export function verificationExpiry(minutes = 15) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export function verificationExpired(value?: string) {
  if (!value) return true;
  const time = new Date(value).getTime();
  return !Number.isFinite(time) || time < Date.now();
}
