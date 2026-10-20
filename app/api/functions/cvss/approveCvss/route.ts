import { NextRequest } from "next/server";
import { handleApproveCvss } from "@/lib/cvss/approve-cvss-handler";

export async function POST(request: NextRequest) {
  return handleApproveCvss(request);
}
