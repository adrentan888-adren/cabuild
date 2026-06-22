import { NextRequest, NextResponse } from "next/server";
import { decodeUploadKey, readUpload } from "@/lib/providers/uploads";

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const key = decodeUploadKey(params.token);
    const { buffer, contentType } = await readUpload(key);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload not found." }, { status: 404 });
  }
}
