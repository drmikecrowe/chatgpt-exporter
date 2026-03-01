import path from "path";
import { saveFile, categorizeByKeywords } from "../utils.mjs";

const CATEGORIES = [
  "Personal Details",
  "Work & Professional",
  "Technical Preferences",
  "Communication Style",
  "Projects & Goals",
  "Other Preferences",
];

function categorizeMemory(text) {
  const lower = text.toLowerCase();
  if (/\b(name is|lives? in|born|age|family|wife|husband|child|daughter|son|pet|city|country)\b/.test(lower))
    return "Personal Details";
  if (/\b(work|job|company|role|team|manager|employ|colleague|business|startup|founder)\b/.test(lower))
    return "Work & Professional";
  if (/\b(prefer|language|framework|editor|ide|stack|python|javascript|rust|go|react|terminal|vim|vscode|code style|indent|tabs|spaces|dark mode)\b/.test(lower))
    return "Technical Preferences";
  if (/\b(tone|verbose|concise|formal|casual|respond|write|style|format|explain|brief|detailed|bullet|markdown)\b/.test(lower))
    return "Communication Style";
  if (/\b(project|goal|building|working on|planning|learning|studying|wants to|trying to)\b/.test(lower))
    return "Projects & Goals";
  return "Other Preferences";
}

export async function transformMemories(memories, opts) {
  if (!Array.isArray(memories) || memories.length === 0) {
    console.log("  ℹ️  No memories to transform.");
    return { total: 0, files: [] };
  }

  const buckets = Object.fromEntries(CATEGORIES.map((c) => [c, []]));

  for (const mem of memories) {
    const text = (mem.content || mem.value || mem.text || mem.memory || "").trim();
    if (!text) continue;
    const cat = categorizeMemory(text);
    buckets[cat].push(text);
  }

  // --- memory-import.txt (for claude.ai / Claude mobile app paste) ---
  let importText = "# Memories imported from ChatGPT\n\n";
  importText += `Total: ${memories.length} memories\n\n`;

  for (const cat of CATEGORIES) {
    const items = buckets[cat];
    if (items.length === 0) continue;
    importText += `## ${cat}\n`;
    for (const item of items) {
      importText += `- ${item}\n`;
    }
    importText += "\n";
  }

  saveFile(path.join(opts.outputDir, "memory-import.txt"), importText, opts.dryRun);

  // --- CLAUDE.md section (returned for master file) ---
  let claudeSection = "## Memories (imported from ChatGPT)\n\n";
  for (const cat of CATEGORIES) {
    const items = buckets[cat];
    if (items.length === 0) continue;
    claudeSection += `### ${cat}\n`;
    for (const item of items) {
      claudeSection += `- ${item}\n`;
    }
    claudeSection += "\n";
  }

  const categoryCounts = Object.fromEntries(
    CATEGORIES.map((c) => [c, buckets[c].length])
  );

  console.log(`  📝 Memories: ${memories.length} total`);
  for (const [cat, count] of Object.entries(categoryCounts)) {
    if (count > 0) console.log(`     ${cat}: ${count}`);
  }

  return {
    total: memories.length,
    categorized: categoryCounts,
    claudeSection,
    files: ["memory-import.txt"],
  };
}
