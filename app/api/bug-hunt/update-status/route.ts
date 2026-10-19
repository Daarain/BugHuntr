import { NextResponse } from 'next/server';

/**
 * Disabled API endpoint.
 * This orphaned endpoint has been retired and disabled to prevent unauthorized status mutations.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Endpoint retired: This API route has been disabled.' },
    { status: 410 }
  );
}
