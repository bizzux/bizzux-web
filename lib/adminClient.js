"use client";
// Browser helper for the Admin Center screens: calls a Bizzux API with the signed-in person's token and throws the server's message on failure.
import { auth } from "@/lib/firebase";

export async function adminApi(path, method = "GET", body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(path, { method, headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = {}; try { d = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(d.error || "Request failed");
  return d;
}
