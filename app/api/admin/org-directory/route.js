import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requirePlatformPermission } from "@/lib/platformRoles";
import { queryDirectory, reindexBatch } from "@/lib/orgDirectory";
import { loadOrg, normalizeOrganizationRow, isAdminManaged, assertOrgPermission } from "@/lib/orgProvisioning";
import { listOrgUsers } from "@/lib/orgManagement";
import { resolveOrgOwners } from "@/lib/orgOwners";
import { deriveStatus } from "@/lib/orgStatus";
import { APPS } from "@/lib/appCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read side of Super Admin -> Organizations: the server-searched directory and
// the per-organization details. Every call is permission-checked on the
// server (organizations.view); writes stay in /api/admin/organizations and
// the older /api/admin/customers actions, each with their own permission checks.

const toIso = (t) => (t && typeof t.toDate === "function" ? t.toDate().toISOString() : t || null);

export async function GET(req) {
  try {
    const c = await requirePlatformPermission(req, "organizations.view");
    const url = new URL(req.url);
    const p = (k) => url.searchParams.get(k) || undefined;
    const id = p("id");

    if (!id) {
      const result = await queryDirectory({
        q: p("q") || "", accountStatus: p("accountStatus"), kind: p("kind"), planType: p("planType"),
        excludeStatus: p("hideArchived") === "0" || p("accountStatus") ? undefined : "archived",
        sort: p("sort") === "name" ? "name" : "created", dir: p("dir"), limit: p("limit"), cursor: p("cursor"),
      });
      return NextResponse.json(result);
    }

    const section = p("section");
    if (section === "users") {
      return NextResponse.json(await listOrgUsers({ actor: c, organizationId: id, readOnly: true }));
    }
    if (section === "audit") {
      await assertOrgPermission(c, "organizations.view");
      const db = adminDb();
      const [direct, nested] = await Promise.all([
        db.collection("auditLogs").where("targetId", "==", id).limit(100).get(),
        db.collection("auditLogs").where("details.organizationId", "==", id).limit(100).get(),
      ]);
      const seen = new Set();
      const entries = [...direct.docs, ...nested.docs]
        .filter((d) => (seen.has(d.id) ? false : seen.add(d.id)))
        .map((d) => ({ id: d.id, ...d.data(), createdAt: toIso(d.data().createdAt) }))
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 100);
      return NextResponse.json({ entries });
    }
    if (section === "apps") {
      const subs = await adminDb().collection("organizationAppSubscriptions").where("organizationId", "==", id).get();
      const status = Object.fromEntries(subs.docs.map((d) => [d.data().appId, d.data()]));
      return NextResponse.json({
        apps: APPS.map((a) => ({ id: a.id, name: a.name, enabled: status[a.id]?.status === "ACTIVE", subscriptionType: status[a.id]?.subscriptionType || null, known: !!status[a.id] })),
      });
    }

    // Overview
    const { org, customer } = await loadOrg(id);
    const [owners, count] = await Promise.all([
      resolveOrgOwners([id], { includeAdmins: true }),
      adminDb().collection("organizationMemberships").where("organizationId", "==", id).where("status", "==", "active").count().get(),
    ]);
    const row = normalizeOrganizationRow(id, org, customer, count.data().count);
    const usage = customer?.appUsage
      ? Object.fromEntries(Object.entries(customer.appUsage).map(([k, v]) => [k, toIso(v)]))
      : {};
    return NextResponse.json({
      row,
      status: deriveStatus(customer, org),
      owner: owners[id]?.owner || null,
      managed: isAdminManaged(org, customer),
      hasCustomerRecord: !!customer,
      usage,
      onboarding: customer ? {
        jobTitle: customer.jobTitle || null, useCase: customer.useCase || null,
        employeeCount: customer.employeeCount || null, businessType: customer.businessType || null,
      } : null,
      permissions: c.permissions,
      role: c.platformRole,
      createdAt: toIso(org.createdAt),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}

// Owner/Admin maintenance: rebuild the search index a slice at a time.
export async function POST(req) {
  try {
    const c = await requirePlatformPermission(req, "organizations.manage");
    const body = await req.json();
    if (body.action === "reindex") {
      const r = await reindexBatch({ after: body.after || null, budgetMs: 40000 });
      return NextResponse.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
    }
    throw { status: 400, message: "Unknown action" };
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 500 });
  }
}
