import { type NextRequest, NextResponse } from "next/server";

import { getSearchApi } from "@/src/server/api/routes.ts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_STATIC_EXPORT === "true") {
    return NextResponse.json({
      ok: false,
      error: {
        code: "STATIC_EXPORT_READONLY",
        message: "static export searches anime data from /static-data/anime.json"
      }
    });
  }

  const result = await getSearchApi(request.nextUrl.searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
