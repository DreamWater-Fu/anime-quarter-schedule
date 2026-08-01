import { type NextRequest, NextResponse } from "next/server";

import { getAnimeItemsApi } from "@/src/server/api/routes.ts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_STATIC_EXPORT === "true") {
    return NextResponse.json({
      ok: false,
      error: {
        code: "STATIC_EXPORT_READONLY",
        message: "static export reads anime items from /static-data/anime.json"
      }
    });
  }

  const result = await getAnimeItemsApi(request.nextUrl.searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
