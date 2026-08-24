import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Waitlist signup.
 *
 * This route used to `console.log` the address, sleep 800ms, and return
 * `{ success: true }` — so every signup was silently dropped while the UI
 * reported success. It now persists to the `WaitlistSignup` table, and when no
 * database is configured it returns 503 rather than lying to the visitor.
 * Re-submitting the same address is idempotent, not an error.
 */
export async function POST(request: Request) {
  let email: unknown;
  try {
    ({ email } = await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  const normalized = email.trim().toLowerCase();

  if (!process.env.DATABASE_URL) {
    // Fail honestly. A visitor who is told they are on the list must actually
    // be on the list.
    console.error("[/api/waitlist] DATABASE_URL is not set — refusing to report success");
    return NextResponse.json(
      { error: "Waitlist is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  try {
    await prisma.waitlistSignup.upsert({
      where: { email: normalized },
      update: {},
      create: { email: normalized },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/waitlist] Failed to persist signup:", error);
    return NextResponse.json(
      { error: "Waitlist is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }
}
