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
};

export const posts: BlogPost[] = [
  {
    slug: "signs-your-shop-has-outgrown-spreadsheets",
    title: "5 signs your shop has outgrown spreadsheets",
    excerpt:
      "Spreadsheets are free and familiar, which is exactly why most small shops start there. Here's how to tell when they've quietly started costing you more than they save.",
    date: "2026-09-16",
    readTime: "5 min read",
    tags: ["Inventory", "Small Business"],
    body: [
      {
        type: "p",
        text: "Almost every small shop starts the same way: a notebook, then a spreadsheet. It's free, everyone kind of knows how to use it, and for the first few months it genuinely works. The trouble is spreadsheets don't fail loudly — they fail quietly, one small workaround at a time, until one day you realize you're spending more time managing the spreadsheet than running the shop.",
      },
      { type: "h2", text: "1. You're the only one who understands the file" },
      {
        type: "p",
        text: "If a staff member has to call you to ask \"which sheet do I put today's sales in,\" the spreadsheet has stopped being a tool and started being a dependency on you personally. That doesn't scale past one person, and it definitely doesn't survive a day you're unreachable.",
      },
      { type: "h2", text: "2. Your stock count and your shelf count disagree" },
      {
        type: "p",
        text: "This is the most common tell. A spreadsheet only knows what someone typed into it — it has no idea a sale happened unless a human remembers to log it. Every missed entry is a small drift between what your sheet says and what's actually on the shelf, and drift compounds. Six months in, a stock count that should take twenty minutes takes half a day because nothing lines up.",
      },
      { type: "h2", text: "3. You find out you're low on something by running out of it" },
      {
        type: "p",
        text: "A spreadsheet can hold a reorder threshold, but it can't tap you on the shoulder when you cross it. Real inventory systems flag low stock automatically, before a customer asks for something you don't have.",
      },
      { type: "h2", text: "4. \"Profit\" and \"sales\" have started to mean the same thing to you" },
      {
        type: "p",
        text: "Tracking sales in a spreadsheet is easy. Tracking sales minus cost of goods minus expenses — the number that actually tells you if you're making money — is where most spreadsheets quietly stop. If you can tell me today's revenue but not today's profit, this is the sign to pay attention to.",
      },
      { type: "h2", text: "5. Every new staff member means another round of \"let me show you the sheet\"" },
      {
        type: "p",
        text: "Training time is a real cost. A spreadsheet has no permissions, no guardrails, and no undo history — one wrong keystroke from a new hire and a formula three tabs away breaks silently.",
      },
      {
        type: "quote",
        text: "None of this means spreadsheets are bad — they're a genuinely good way to start. The signs above just mark the point where the thing that got you started is now the thing holding you back.",
      },
      {
        type: "p",
        text: "If two or more of these sound familiar, it's worth trying a system built for it rather than one repurposed for it. Bizzux handles POS, live inventory, expenses, and real profit tracking in one place — built for exactly this handoff moment.",
      },
    ],
  },
  {
    slug: "pos-vs-spreadsheets-what-actually-saves-time",
    title: "POS vs. spreadsheets: what actually saves you time",
    excerpt:
      "\"I'll switch once I have more time\" is the trap — the spreadsheet is what's costing you the time in the first place. A honest breakdown of where the hours actually go.",
    date: "2026-09-16",
    readTime: "4 min read",
    tags: ["POS", "Productivity"],
    body: [
      {
        type: "p",
        text: "Every shop owner who's still on spreadsheets has said some version of the same thing: \"I'll move to proper software once things calm down.\" The honest problem with that plan is that the spreadsheet itself is a big part of why things never calm down.",
      },
      { type: "h2", text: "Where the hours actually go" },
      {
        type: "ul",
        items: [
          "Manually typing each sale into a sheet, instead of it being logged the moment you ring it up",
          "Reconciling cash drawer totals against what the sheet says you should have",
          "Re-checking stock by physically counting shelves because the sheet hasn't been trustworthy in months",
          "Building a monthly profit summary by hand, pulling numbers from three different tabs",
          "Fixing a broken formula that someone's new hire accidentally overtyped",
        ],
      },
      {
        type: "p",
        text: "None of these is a huge task on its own. That's exactly why they never feel worth fixing — each one is \"only ten minutes.\" Add them up across a week and it's often several hours that produced zero new sales, zero happier customers, and zero business insight beyond what a proper system gives you automatically.",
      },
      { type: "h2", text: "What a POS actually removes, not just speeds up" },
      {
        type: "p",
        text: "The honest pitch for POS software isn't \"it's faster to type.\" It's that most of the above tasks stop being tasks. A sale rung up on a POS is already logged — there's no second step. Stock decreases the moment an item sells, not whenever someone remembers to update a sheet. Profit is a number you can see today, not something you reconstruct at month-end.",
      },
      {
        type: "p",
        text: "The time saved isn't really about typing speed — it's about deleting entire steps from your day rather than doing them faster.",
      },
      {
        type: "quote",
        text: "The right question isn't \"do I have time to switch?\" — it's \"how many hours a week am I currently spending on work the software would do for free?\"",
      },
    ],
  },
  {
    slug: "tracking-real-profit-not-just-sales",
    title: "A simple guide to tracking real profit, not just sales",
    excerpt:
      "Revenue is a vanity number if you're not subtracting cost of goods and expenses from it. Here's a straightforward way to see what you're actually keeping.",
    date: "2026-09-16",
    readTime: "5 min read",
    tags: ["Profit", "Expenses"],
    body: [
      {
        type: "p",
        text: "\"How's business?\" gets answered with a sales number far more often than a profit number, and that's understandable — sales is the number that's easiest to see. It's also, on its own, close to meaningless for knowing whether you're actually making money.",
      },
      { type: "h2", text: "The three numbers that actually matter" },
      {
        type: "ul",
        items: [
          "Revenue — total money coming in from sales",
          "Cost of goods sold (COGS) — what you paid to acquire or make what you sold",
          "Operating expenses — rent, salaries, utilities, everything else it costs to keep the doors open",
        ],
      },
      {
        type: "p",
        text: "Profit is revenue minus both of the others. A shop doing ₹5,00,000 in monthly sales sounds healthy — but if COGS is ₹3,50,000 and expenses are ₹1,20,000, the actual profit is ₹30,000. Same \"good month\" headline, very different reality underneath it.",
      },
      { type: "h2", text: "Why this is so easy to lose track of" },
      {
        type: "p",
        text: "Sales data lives in one place — your till or POS. Cost data is scattered: supplier invoices, staff salaries, electricity bills, rent, the odd cash expense nobody wrote down. Pulling all three together by hand, every month, is exactly the kind of task that quietly stops happening once things get busy — which is precisely when you most need to know the real number.",
      },
      { type: "h2", text: "A simple habit that fixes most of this" },
      {
        type: "ul",
        items: [
          "Log expenses the same day they happen, not at month-end from memory",
          "Record cost price per item, not just selling price, so margin is calculated automatically instead of guessed",
          "Check a profit number weekly, not just once a month — small problems are easier to catch early",
        ],
      },
      {
        type: "p",
        text: "The habit matters more than the tool, but the tool decides whether the habit survives a busy week. Bizzux logs cost price against every item and every expense as it happens, so the profit number is always current — not a project you have to sit down and reconstruct.",
      },
    ],
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return posts.find((p) => p.slug === slug);
}

export function getAllSlugs(): string[] {
  return posts.map((p) => p.slug);
}
