import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/server-auth";

export async function POST() {
  const response = NextResponse.json(
    { success: true, message: "Logged out successfully." },
    { status: 200 }
  );

  clearSessionCookie(response);
  return response;
}
