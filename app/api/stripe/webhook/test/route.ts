import { POST as handleWebhook } from "../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleWebhook(req);
}
