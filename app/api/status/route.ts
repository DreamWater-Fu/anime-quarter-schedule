import { NextResponse } from "next/server";

import { getStatusApi } from "@/src/server/api/routes.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NEXT_PUBLIC_STATIC_EXPORT === "true") {
    return NextResponse.json({
      ok: false,
      error: {
        code: "STATIC_EXPORT_READONLY",
        message: "static export reads update status from /static-data/status.json"
      }
    });
  }

  const result = await getStatusApi();
  return NextResponse.json(result.body, { status: result.status });
}
