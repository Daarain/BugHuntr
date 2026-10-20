import { NextRequest } from "next/server";
import { handleRequestCve } from "@/lib/cvss/request-cve-handler";

export async function POST(request: NextRequest) {
  return handleRequestCve(request);
}
