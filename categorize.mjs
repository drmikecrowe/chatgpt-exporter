#!/usr/bin/env node
/**
 * categorize.mjs — Group exported conversations into Claude Project bundles
 *
 * Reads all .md files from claude-import/conversations/by-date/,
 * categorizes each using the 15-topic refined system, then groups
 * into project bundles capped at 180k tokens.
 *
 * Usage:
 *   node categorize.mjs            # Create bundles in claude-projects/
 *   node categorize.mjs --stats    # Show category stats without writing
 *   node categorize.mjs --dry-run  # Preview what would be created
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { categorizeRefined } from "./lib/categories.mjs";
import { sanitizeFilename } from "./lib/utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.join(__dirname, "claude-import", "conversations", "by-date");
const OUTPUT_DIR = path.join(__dirname, "claude-projects");

const args = process.argv.slice(2);
const STATS_ONLY = args.includes("--stats");
const DRY_RUN = args.includes("--dry-run");

const TOKEN_LIMIT = 180_000; // buffer below 200k project limit

/**
 * Estimate token count from file size (markdown ≈ 4 bytes per token).
 */
function estimateTokens(bytes) {
  return Math.ceil(bytes / 4);
}

/**
 * Extract title and first N user messages from a conversation markdown file.
 */
function parseConversation(content) {
  // Title is the first # heading
  const titleMatch = content.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "";

  // Extract user messages (text after ### **You** headings)
  const userBlocks = [];
  const parts = content.split(/### \*\*You\*\*/);
  for (let i = 1; i < parts.length && userBlocks.length < 5; i++) {
    // Take text up to the next ### heading
    const block = parts[i].split(/### \*\*/)[0].trim();
    if (block) userBlocks.push(block);
  }

  return { title, body: userBlocks.join("\n").slice(0, 2000) };
}

/**
 * Recursively find all .md files in a directory.
 */
function findMarkdownFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extract date from file path (YYYY-MM folder) or file content.
 */
function extractDate(filePath, content) {
  // Try to get from directory name (YYYY-MM)
  const dirMatch = filePath.match(/(\d{4}-\d{2})\//);
  if (dirMatch) return dirMatch[1];

  // Fallback: parse from content
  const dateMatch = content.match(/\*Date:\s*(\d{4}-\d{2})/);
  return dateMatch ? dateMatch[1] : "unknown";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("\n📂 Scanning conversations...\n");

  const files = findMarkdownFiles(SOURCE_DIR);
  if (files.length === 0) {
    console.error("❌ No .md files found in", SOURCE_DIR);
    console.error("   Run the migration first:  node migrate.mjs");
    process.exit(1);
  }

  console.log(`  Found ${files.length} conversation files\n`);

  // Categorize all files
  const categorized = [];
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf-8");
    const bytes = Buffer.byteLength(content, "utf-8");
    const tokens = estimateTokens(bytes);
    const { title, body } = parseConversation(content);
    const topic = categorizeRefined(title, body);
    const date = extractDate(filePath, content);

    categorized.push({ filePath, title, topic, date, bytes, tokens, content });
  }

  // Group by topic
  const groups = {};
  for (const item of categorized) {
    if (!groups[item.topic]) groups[item.topic] = [];
    groups[item.topic].push(item);
  }

  // Sort each group by date
  for (const items of Object.values(groups)) {
    items.sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---------------------------------------------------------------------------
  // Stats mode
  // ---------------------------------------------------------------------------
  if (STATS_ONLY) {
    console.log("  Category breakdown:\n");
    const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    let totalTokens = 0;
    for (const [topic, items] of sorted) {
      const topicTokens = items.reduce((sum, i) => sum + i.tokens, 0);
      totalTokens += topicTokens;
      const bar = "█".repeat(Math.ceil(items.length / 10));
      console.log(
        `  ${topic.padEnd(25)} ${String(items.length).padStart(4)} files  ${String(Math.round(topicTokens / 1000) + "k").padStart(6)} tokens  ${bar}`
      );
    }
    console.log(`\n  Total: ${categorized.length} files, ~${Math.round(totalTokens / 1000)}k tokens\n`);
    return;
  }

  // ---------------------------------------------------------------------------
  // Build bundles (split categories that exceed token limit)
  // ---------------------------------------------------------------------------
  const bundles = [];
  const topicNames = Object.keys(groups).sort();

  for (const topic of topicNames) {
    const items = groups[topic];
    let currentBundle = [];
    let currentTokens = 0;
    let partNum = 1;

    for (const item of items) {
      if (currentTokens + item.tokens > TOKEN_LIMIT && currentBundle.length > 0) {
        bundles.push({ topic, part: partNum, items: currentBundle, tokens: currentTokens });
        partNum++;
        currentBundle = [];
        currentTokens = 0;
      }
      currentBundle.push(item);
      currentTokens += item.tokens;
    }

    if (currentBundle.length > 0) {
      bundles.push({ topic, part: partNum, items: currentBundle, tokens: currentTokens });
    }
  }

  // Assign bundle numbers and directory names
  for (let i = 0; i < bundles.length; i++) {
    const b = bundles[i];
    const num = String(i + 1).padStart(2, "0");
    const topicSlug = b.topic.replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/, "");
    const totalParts = bundles.filter((x) => x.topic === b.topic).length;
    const partSuffix = totalParts > 1 ? `-Part-${b.part}` : "";
    b.dirName = `${num}-${topicSlug}${partSuffix}`;
    b.projectName = `ChatGPT: ${b.topic}${totalParts > 1 ? ` (Part ${b.part})` : ""}`;
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log(`  ${bundles.length} bundles to create:\n`);
  for (const b of bundles) {
    console.log(
      `    ${b.dirName.padEnd(40)} ${String(b.items.length).padStart(4)} files  ${String(Math.round(b.tokens / 1000) + "k").padStart(6)} tokens`
    );
  }
  console.log();

  if (DRY_RUN) {
    console.log("  [dry-run] No files written.\n");
    return;
  }

  // ---------------------------------------------------------------------------
  // Write bundles
  // ---------------------------------------------------------------------------
  // Clean output dir
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const manifest = {
    createdAt: new Date().toISOString(),
    totalFiles: categorized.length,
    totalBundles: bundles.length,
    bundles: [],
  };

  for (const b of bundles) {
    const bundleDir = path.join(OUTPUT_DIR, b.dirName);
    fs.mkdirSync(bundleDir, { recursive: true });

    // Track filenames to handle collisions
    const usedNames = new Set();

    const fileList = [];
    for (const item of b.items) {
      let baseName = sanitizeFilename(item.title || "Untitled") + ".md";

      // Handle filename collisions by appending date suffix
      if (usedNames.has(baseName)) {
        const stem = baseName.replace(/\.md$/, "");
        baseName = `${stem}_${item.date}.md`;
      }
      // Still collides? Add counter
      let finalName = baseName;
      let counter = 2;
      while (usedNames.has(finalName)) {
        finalName = baseName.replace(/\.md$/, `_${counter}.md`);
        counter++;
      }
      usedNames.add(finalName);

      fs.writeFileSync(path.join(bundleDir, finalName), item.content);
      fileList.push({
        filename: finalName,
        title: item.title,
        date: item.date,
        tokens: item.tokens,
      });
    }

    // Write _project.json
    const projectMeta = {
      projectName: b.projectName,
      topic: b.topic,
      part: b.part,
      fileCount: b.items.length,
      estimatedTokens: b.tokens,
      files: fileList,
    };
    fs.writeFileSync(
      path.join(bundleDir, "_project.json"),
      JSON.stringify(projectMeta, null, 2)
    );

    // Write _README.md (table of contents)
    let readme = `# ${b.projectName}\n\n`;
    readme += `${b.items.length} conversations · ~${Math.round(b.tokens / 1000)}k tokens\n\n`;
    readme += `## Table of Contents\n\n`;
    for (const f of fileList) {
      readme += `- **${f.title || f.filename}** (${f.date})\n`;
    }
    fs.writeFileSync(path.join(bundleDir, "_README.md"), readme);

    // Add to manifest
    manifest.bundles.push({
      dirName: b.dirName,
      projectName: b.projectName,
      topic: b.topic,
      part: b.part,
      fileCount: b.items.length,
      estimatedTokens: b.tokens,
      uploadStatus: "pending",
    });
  }

  // Write manifest
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "_manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`  ✅ Created ${bundles.length} bundles in ${OUTPUT_DIR}/`);
  console.log(`  ✅ Manifest written to ${OUTPUT_DIR}/_manifest.json\n`);
}

main();
