import { type NextRequest, NextResponse } from "next/server";

import { postUpdateApi } from "@/src/server/api/routes.ts";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = authorizeUpdateRequest(request);
  if (guard) return guard;

  const body = await request.json().catch(() => ({}));
  const result = await postUpdateApi(body);
  return NextResponse.json(result.body, { status: result.status });
}

function authorizeUpdateRequest(request: NextRequest): NextResponse | null {
  if (process.env.VERCEL === "1" && process.env.ENABLE_VERCEL_UPDATE !== "true") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UPDATE_READ_ONLY_DEPLOYMENT",
          message: "online deployment is read-only; run manual updates from the authorized local client"
        }
      },
      { status: 403 }
    );
  }

  const token = process.env.UPDATE_API_TOKEN;
  if (!token) return null;

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const headerToken = request.headers.get("x-update-token");
  if (bearer === token || headerToken === token) return null;

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "UNAUTHORIZED_UPDATE",
        message: "update token is missing or invalid"
      }
    },
    { status: 401 }
  );
}
