// Parse a free-text tag expression like:
//   "rust AND tutorial NOT beginner"
//   "music OR podcast NOT live"
// into the params the API takes: { tags, tag_op, exclude_tags }.
//
// Rules:
// - Bare tokens act as required ANDed tags by default.
// - "OR" between tokens switches the op for everything in the include set.
// - "NOT <tag>" or "-<tag>" excludes.
// - Quoted strings are taken as single tags ("multi word").

export interface ParsedTagQuery {
  tags: string[];
  tag_op: "AND" | "OR";
  exclude_tags: string[];
}

export function parseTagQuery(input: string): ParsedTagQuery {
  const tokens: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) tokens.push(m[1] ?? m[2]);

  const tags: string[] = [];
  const exclude: string[] = [];
  let op: "AND" | "OR" = "AND";
  let negateNext = false;

  for (const raw of tokens) {
    const t = raw.trim();
    if (!t) continue;
    const upper = t.toUpperCase();
    if (upper === "AND") { op = "AND"; continue; }
    if (upper === "OR") { op = "OR"; continue; }
    if (upper === "NOT") { negateNext = true; continue; }
    if (t.startsWith("-") && t.length > 1) {
      exclude.push(t.slice(1).toLowerCase());
      continue;
    }
    if (negateNext) {
      exclude.push(t.toLowerCase());
      negateNext = false;
    } else {
      tags.push(t.toLowerCase());
    }
  }

  return { tags, tag_op: op, exclude_tags: exclude };
}
