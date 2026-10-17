import { NextResponse } from "next/server";
import { requirePlatformPermission } from "@/lib/platformRoles";
import {
  createTicket, getTicket, updateTicket, addNote, listTickets, ticketSummary, listAssignees,
  STATUSES, PRIORITIES, CATEGORIES,
} from "@/lib/supportTickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Customer Support workspace API (lib/supportTickets.js). Every call needs the
// support.tickets permission (Owner, Platform Admin, Support Agent).

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET(req) {
  try {
    const c = await requirePlatformPermission(req, "support.tickets");
    const url = new URL(req.url);
    const p = (k) => url.searchParams.get(k) || undefined;
    if (p("id")) return NextResponse.json({ ...(await getTicket({ actor: c, id: p("id") })), me: c.uid }, NO_STORE);
    if (p("summary") === "1") return NextResponse.json(await ticketSummary({ actor: c }), NO_STORE);
    if (p("assignees") === "1") {
      return NextResponse.json({ assignees: await listAssignees({ actor: c }), statuses: STATUSES, priorities: PRIORITIES, categories: CATEGORIES, me: c.uid }, NO_STORE);
    }
    return NextResponse.json(
      await listTickets({
        actor: c, status: p("status"), assignee: p("assignee"), priority: p("priority"), organizationId: p("org"),
        due: p("due") === "1", awaiting: p("awaiting") === "1", limit: p("limit"), cursor: p("cursor"),
      }),
      NO_STORE,
    );
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const c = await requirePlatformPermission(req, "support.tickets");
    const body = await req.json();
    if (body.action === "create") return NextResponse.json({ ok: true, ticket: await createTicket({ actor: c, body }) });
    if (body.action === "update") return NextResponse.json(await updateTicket({ actor: c, id: body.id, patch: body.patch || {} }));
    if (body.action === "note") return NextResponse.json(await addNote({ actor: c, id: body.id, body: body.body, visibility: body.visibility }));
    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
