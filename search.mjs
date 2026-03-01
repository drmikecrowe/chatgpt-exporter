#!/usr/bin/env node
/**
 * search.mjs — Search and browse exported ChatGPT conversations
 *
 * Usage:
 *   node search.mjs "duck bog"          Search for conversations matching "duck bog"
 *   node search.mjs "duck bog" --full   Show full conversation content (not just matches)
 *   node search.mjs --list              List all conversations
 *   node search.mjs --list --topic      List grouped by topic
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BY_DATE_DIR = path.join(__dirname, "claude-import", "conversations", "by-date");
const EXPORT_DIR = path.join(__dirname, "export", "conversations");

// ANSI colors
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
};

function paint(color, text) {
  return `${color}${text}${c.reset}`;
}

// ---------------------------------------------------------------------------
// Gather all conversation markdown files
// ---------------------------------------------------------------------------

function getAllConversations() {
  const results = [];

  if (!fs.existsSync(BY_DATE_DIR)) {
    console.error(paint(c.red, "  No conversations found. Run the export + migrate first."));
    process.exit(1);
  }

  const months = fs.readdirSync(BY_DATE_DIR).filter((d) => {
    return fs.statSync(path.join(BY_DATE_DIR, d)).isDirectory();
  });

  for (const month of months) {
    const monthDir = path.join(BY_DATE_DIR, month);
    const files = fs.readdirSync(monthDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const filePath = path.join(monthDir, file);
      const title = file.replace(/\.md$/, "").replace(/_/g, " ");
      results.push({ title, month, file, filePath });
    }
  }

  return results.sort((a, b) => b.month.localeCompare(a.month) || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function searchConversations(query, conversations) {
  const terms = query.toLowerCase().split(/\s+/);
  const matches = [];

  for (const convo of conversations) {
    const content = fs.readFileSync(convo.filePath, "utf-8");
    const lower = content.toLowerCase();

    // All terms must appear somewhere in the content (title or body)
    const allMatch = terms.every((t) => lower.includes(t));
    if (!allMatch) continue;

    // Find matching lines for context
    const lines = content.split("\n");
    const contextLines = [];
    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      if (terms.some((t) => lineLower.includes(t))) {
        contextLines.push({ lineNum: i + 1, text: lines[i].trim() });
        if (contextLines.length >= 5) break;
      }
    }

    // Extract date and model from markdown header
    const dateMatch = content.match(/\*Date:\s*(.+?)\*/);
    const modelMatch = content.match(/\*Model:\s*(.+?)\*/);

    matches.push({
      ...convo,
      date: dateMatch ? dateMatch[1] : convo.month,
      model: modelMatch ? modelMatch[1] : "unknown",
      contextLines,
      messageCount: (content.match(/^### \*\*/gm) || []).length,
    });
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function highlightTerms(text, terms) {
  let result = text;
  for (const term of terms) {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    result = result.replace(regex, `${c.yellow}${c.bold}$1${c.reset}`);
  }
  return result;
}

function printSearchResults(matches, query) {
  const terms = query.toLowerCase().split(/\s+/);

  console.log(
    `\n  ${paint(c.green, `${matches.length}`)} conversation${matches.length !== 1 ? "s" : ""} matching ${paint(c.cyan + c.bold, `"${query}"`)}\n`
  );

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const num = paint(c.cyan + c.bold, `[${i + 1}]`);
    const title = highlightTerms(m.title, terms);
    const meta = paint(c.dim, `${m.date} · ${m.messageCount} messages · ${m.model}`);

    console.log(`  ${num}  ${paint(c.bold, "")}${title}`);
    console.log(`       ${meta}`);

    // Show context snippets
    for (const cl of m.contextLines.slice(0, 3)) {
      const snippet = cl.text.substring(0, 120);
      console.log(`       ${paint(c.dim, ">")} ${highlightTerms(snippet, terms)}`);
    }

    console.log(`       ${paint(c.dim, m.filePath)}`);
    console.log();
  }
}

function printFullConversation(match) {
  const content = fs.readFileSync(match.filePath, "utf-8");
  console.log(`\n${"─".repeat(80)}`);
  console.log(content);
  console.log(`${"─".repeat(80)}\n`);
}

function printList(conversations, byTopic) {
  if (byTopic) {
    // Group by month
    const grouped = {};
    for (const c of conversations) {
      if (!grouped[c.month]) grouped[c.month] = [];
      grouped[c.month].push(c);
    }

    for (const month of Object.keys(grouped).sort().reverse()) {
      console.log(`\n  ${paint(c.cyan + c.bold, month)} ${paint(c.dim, `(${grouped[month].length} conversations)`)}`);
      for (const convo of grouped[month]) {
        console.log(`    ${convo.title}`);
      }
    }
  } else {
    console.log(`\n  ${paint(c.green, `${conversations.length}`)} total conversations\n`);
    for (const convo of conversations) {
      console.log(`  ${paint(c.dim, convo.month)}  ${convo.title}`);
    }
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const positional = args.filter((a) => !a.startsWith("--"));

const showFull = flags.includes("--full");
const listMode = flags.includes("--list");
const topicMode = flags.includes("--topic");

const conversations = getAllConversations();

if (listMode) {
  printList(conversations, topicMode);
  process.exit(0);
}

if (positional.length === 0) {
  console.log(`
  ${paint(c.bold, "ChatGPT Conversation Search")}

  ${paint(c.cyan, "Usage:")}
    node search.mjs "duck bog"          Search conversations
    node search.mjs "duck bog" --full   Search + show full content of matches
    node search.mjs --list              List all conversations
    node search.mjs --list --topic      List grouped by month

  ${paint(c.cyan, "Tips:")}
    Multiple words = all must appear (AND search)
    Search covers titles AND full message content
    ${paint(c.dim, `${conversations.length} conversations available`)}
`);
  process.exit(0);
}

const query = positional.join(" ");
const matches = searchConversations(query, conversations);

if (matches.length === 0) {
  console.log(`\n  ${paint(c.yellow, "No conversations found matching")} ${paint(c.bold, `"${query}"`)}\n`);
  process.exit(0);
}

printSearchResults(matches, query);

if (showFull) {
  for (const m of matches) {
    console.log(paint(c.cyan + c.bold, `\n  === ${m.title} ===`));
    printFullConversation(m);
  }
}
