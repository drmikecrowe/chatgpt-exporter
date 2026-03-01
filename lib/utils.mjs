import fs from "fs";
import path from "path";

export function sanitizeFilename(name) {
  return String(name)
    .replace(/[^a-zA-Z0-9_\- ]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

export function loadJSON(dir, filename) {
  const filepath = path.join(dir, filename);
  if (!fs.existsSync(filepath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf-8"));
  } catch {
    return null;
  }
}

export function saveFile(filepath, content, dryRun = false) {
  if (dryRun) {
    console.log(`  [dry-run] Would write: ${filepath}`);
    return;
  }
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, content);
  console.log(`  ✅ ${filepath}`);
}

export function getFlagValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

const TOPIC_KEYWORDS = {
  "Programming & Development": [
    "code", "function", "bug", "debug", "api", "database", "sql",
    "python", "javascript", "typescript", "react", "node", "git",
    "deploy", "server", "frontend", "backend", "algorithm", "class",
    "error", "stack", "npm", "brew", "bash", "shell", "script",
  ],
  "Writing & Content": [
    "write", "essay", "blog", "article", "draft", "edit",
    "grammar", "story", "poem", "script", "content", "copy", "proofread",
    "email", "letter", "report", "summarize", "rewrite",
  ],
  "Research & Learning": [
    "explain", "what is", "how does", "research", "study",
    "learn", "understand", "concept", "theory", "history", "definition",
    "compare", "difference", "overview", "introduction",
  ],
  "Data & Analysis": [
    "data", "analysis", "chart", "graph", "statistics", "csv",
    "spreadsheet", "excel", "calculate", "metric", "dashboard",
    "formula", "pivot", "aggregate", "dataset",
  ],
  "Business & Strategy": [
    "business", "strategy", "market", "customer", "sales",
    "revenue", "growth", "plan", "pitch", "startup", "product",
    "pricing", "competitor", "launch", "roadmap",
  ],
  "Creative & Design": [
    "design", "image", "dalle", "creative", "logo", "color",
    "ui", "ux", "layout", "mockup", "illustration", "art",
    "generate", "draw", "visual", "font", "brand",
  ],
  "Personal & Life": [
    "recipe", "travel", "health", "fitness", "relationship",
    "advice", "personal", "hobby", "home", "family", "food",
    "movie", "book", "gift", "plan", "workout",
  ],
};

export function categorizeByKeywords(text) {
  const lower = text.toLowerCase();
  let bestTopic = "General";
  let bestScore = 0;

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestTopic;
}
