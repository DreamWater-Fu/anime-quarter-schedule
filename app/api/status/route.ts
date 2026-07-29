import { NextResponse } from "next/server";

import { getStatusApi } from "@/src/server/api/routes.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getStatusApi();
  return NextResponse.json(result.body, { status: result.status });
}
