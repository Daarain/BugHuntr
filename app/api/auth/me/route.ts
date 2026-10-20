import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session.authenticated || !session.user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json(
    {
      authenticated: true,
      user: session.user,
    },
    { status: 200 }
  );
}
