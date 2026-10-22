// Profile photo for a person in a company. ONE place for it: the image is checked here, stored once (private Blob, served through the existing
// /api/media proxy) and the URL kept on the person's login (Firebase Auth photoURL), so every app can show the same picture. Tenant check as everywhere:
// only an organization manager, and only for someone who is a member of that company.
import { adminAuth, adminDb } from "../firebaseAdmin";
import { logAuditEvent } from "../audit";
import { resolveOrganizationId } from "./identityService";
import { put } from "@vercel/blob";

export const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

// Pure: -> { ok, ext } | { ok:false, message }. The type must be one we serve AND the bytes must start with that format's signature.
export function checkPhoto(contentType, bytes) {
  const ext = PHOTO_TYPES[String(contentType || "").toLowerCase()];
  if (!ext) return { ok: false, message: "Choose a JPG, PNG or WebP picture." };
  if (!bytes || !bytes.length) return { ok: false, message: "No picture was received." };
  if (bytes.length > PHOTO_MAX_BYTES) return { ok: false, message: "The picture must be under 2 MB." };
  const b = bytes;
  const sig = ext === "jpg" ? b[0] === 0xff && b[1] === 0xd8 : ext === "png" ? b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    : b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return sig ? { ok: true, ext } : { ok: false, message: "That file is not a valid picture." };
}

export async function setUserPhoto({ actor: c, organizationId: requestedOrg, uid, contentType, bytes, origin = "https://www.bizzux.com" }) {
  const organizationId = resolveOrganizationId(c, requestedOrg);
  if (!uid) throw { status: 400, message: "uid required" };
  const member = await adminDb().doc(`organizationMemberships/${organizationId}_${uid}`).get();
  if (!member.exists) throw { status: 404, message: "That person is not a member of this company" };
  const v = checkPhoto(contentType, bytes);
  if (!v.ok) throw { status: 400, message: v.message };
  const path = `avatars/${uid}-${Date.now()}.${v.ext}`;
  await put(path, bytes, { access: "private", contentType });
  const photoURL = `${origin}/api/media/${path}`;
  await adminAuth().updateUser(uid, { photoURL });
  await logAuditEvent({ action: "user.set_photo", actor: c, targetType: "user", targetId: uid, details: { organizationId } });
  return { ok: true, photoURL };
}
