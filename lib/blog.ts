import { adminDb } from "@/lib/firebaseAdmin";

export type BlockType =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "quote"; text: string };

export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  date: string; // ISO date
  readTime: string;
  tags: string[];
  body: BlockType[];
  status: "draft" | "published";
  coverImage?: string | null;
};

// A simple markdown-lite convention so the admin panel's body field can be
// one plain textarea instead of a rich-text editor: blank-line-separated
// paragraphs, "## " for a subheading, consecutive "- " lines grouped into
// one bulleted list, and "> " for a pull-quote. Anything else is a plain
// paragraph. This is deliberately not real Markdown (no bold/italic/links)
// — the goal is "fast to write a daily post in," not full formatting power.
export function parseBody(text: string): BlockType[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: BlockType[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "p", text: para.join(" ").trim() });
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push({ type: "ul", items: list });
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flushPara();
      flushList();
      continue;
    }
    if (line.startsWith("## ")) {
      flushPara();
      flushList();
      blocks.push({ type: "h2", text: line.slice(3).trim() });
    } else if (line.startsWith("- ")) {
      flushPara();
      list.push(line.slice(2).trim());
    } else if (line.startsWith("> ")) {
      flushPara();
      flushList();
      blocks.push({ type: "quote", text: line.slice(2).trim() });
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

// Inverse of parseBody — reconstructs editable markdown-lite text from
// stored blocks, so the admin panel can load an existing post back into
// the same plain textarea it was written in.
export function blocksToText(blocks: BlockType[]): string {
  return blocks
    .map((b) => {
      if (b.type === "h2") return `## ${b.text}`;
      if (b.type === "quote") return `> ${b.text}`;
      if (b.type === "ul") return b.items.map((i) => `- ${i}`).join("\n");
      return b.text;
    })
    .join("\n\n");
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function estimateReadTime(blocks: BlockType[]): string {
  const words = blocks
    .map((b) => (b.type === "ul" ? b.items.join(" ") : b.text))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}

function blogCollection() {
  return adminDb().collection("blogPosts");
}

export async function getPublishedPosts(): Promise<BlogPost[]> {
  try {
    const snap = await blogCollection().where("status", "==", "published").orderBy("date", "desc").get();
    return snap.docs.map((d) => d.data() as BlogPost);
  } catch {
    return [];
  }
}

export async function getPublishedSlugs(): Promise<string[]> {
  const posts = await getPublishedPosts();
  return posts.map((p) => p.slug);
}

export async function getPublishedPost(slug: string): Promise<BlogPost | undefined> {
  try {
    const snap = await blogCollection().doc(slug).get();
    if (!snap.exists) return undefined;
    const post = snap.data() as BlogPost;
    return post.status === "published" ? post : undefined;
  } catch {
    return undefined;
  }
}
