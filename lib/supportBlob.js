// SERVER ONLY. The private Vercel Blob store used for support screenshots.
// Explicit token (not env auto-detection), same as the other private-blob routes.
//
// SUPPORT_BLOB_DIR is for LOCAL TESTING ONLY: when set, screenshots go to that
// folder on disk instead of Vercel Blob, so UAT never writes to the real store.
// It is never set in production.
import { put, head, get, del } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

const token = () => process.env.BLOB_READ_WRITE_TOKEN;
const dir = () => process.env.SUPPORT_BLOB_DIR || "";
const local = (p) => path.join(dir(), p.replace(/[^A-Za-z0-9._-]/g, "_"));

export const supportBlob = {
  put: async (p, body, opts) => {
    if (dir()) { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(local(p), body); fs.writeFileSync(local(p) + ".type", opts.contentType); return { pathname: p }; }
    return put(p, body, { ...opts, token: token() });
  },
  head: async (p) => {
    if (dir()) {
      const f = local(p);
      if (!fs.existsSync(f)) throw new Error("not found");
      return { size: fs.statSync(f).size, contentType: fs.readFileSync(f + ".type", "utf8") };
    }
    return head(p, { token: token() });
  },
  del: async (p) => {
    if (dir()) { for (const f of [local(p), local(p) + ".type"]) if (fs.existsSync(f)) fs.unlinkSync(f); return; }
    await del(p, { token: token() });
  },
  get: async (p) => {
    if (dir()) {
      const f = local(p);
      if (!fs.existsSync(f)) return null;
      return { statusCode: 200, stream: Readable.toWeb(fs.createReadStream(f)) };
    }
    return get(p, { access: "private", token: token() });
  },
};
