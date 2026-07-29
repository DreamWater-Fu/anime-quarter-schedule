import { type NextRequest, NextResponse } from "next/server";

import { getAnimeApi } from "@/src/server/api/routes.ts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await getAnimeApi(request.nextUrl.searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
