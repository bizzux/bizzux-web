// Profile photo checks: only real JPG/PNG/WebP pictures under 2 MB are accepted; the bytes must match the declared type.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPhoto, PHOTO_MAX_BYTES } from "../lib/iam/userPhoto.js";

const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

test("accepts a real picture of each allowed type", () => {
  assert.deepEqual(checkPhoto("image/jpeg", jpg), { ok: true, ext: "jpg" });
  assert.deepEqual(checkPhoto("image/png", png), { ok: true, ext: "png" });
  assert.deepEqual(checkPhoto("image/webp", webp), { ok: true, ext: "webp" });
});

test("refuses other types, empty files, wrong signatures and big files", () => {
  assert.equal(checkPhoto("image/svg+xml", jpg).ok, false, "svg can carry script");
  assert.equal(checkPhoto("text/html", jpg).ok, false);
  assert.equal(checkPhoto("image/jpeg", new Uint8Array(0)).ok, false);
  assert.equal(checkPhoto("image/png", jpg).ok, false, "type and bytes must agree");
  assert.equal(checkPhoto("image/jpeg", new Uint8Array(PHOTO_MAX_BYTES + 1).fill(0xff)).ok, false);
});
