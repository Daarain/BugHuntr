import { NextRequest } from "next/server";
import { handleApproveCvss } from "@/lib/cvss/approve-cvss-handler";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handleApproveCvss(request, id);
}
