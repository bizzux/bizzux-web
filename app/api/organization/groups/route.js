import { NextResponse } from "next/server";
import { requireAccountAdmin } from "@/lib/firebaseAdmin";
import { createGroup, getGroups, deleteGroup } from "@/lib/organizationGroups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const acct = await requireAccountAdmin(req);
    const groups = await getGroups(acct.accountId);
    return NextResponse.json({ groups });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const acct = await requireAccountAdmin(req);
    const body = await req.json();

    if (body.action === "create") {
      const name = String(body.name || "").trim().slice(0, 100);
      if (!name) throw { status: 400, message: "Group name is required" };
      const id = await createGroup(acct.accountId, name);
      return NextResponse.json({ ok: true, id });
    }

    if (body.action === "delete") {
      const groupId = String(body.groupId || "");
      if (!groupId) throw { status: 400, message: "groupId is required" };
      await deleteGroup(acct.accountId, groupId);
      return NextResponse.json({ ok: true });
    }

    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
