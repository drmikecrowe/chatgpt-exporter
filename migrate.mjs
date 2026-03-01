#!/usr/bin/env node
/**
 * ChatGPT → Claude Migrator
 *
 * Reads exported ChatGPT data (from export/) and transforms it into
 * Claude-ready formats in claude-import/:
 *
 *   memories.json        → memory-import.txt  (paste into claude.ai / mobile)
 *                        → CLAUDE.md section  (Claude Code global memory)
 *   custom_instructions  → CLAUDE.md section
 *   custom_gpts.json     → projects/<name>/CLAUDE.md  (one per GPT)
 *   conversations/*.json → conversations/by-date/  + by-topic/  (markdown)
 *
 * Usage:
 *   node migrate.mjs                    Full migration
 *   node migrate.mjs --memories         Only memories
 *   node migrate.mjs --instructions     Only custom instructions
 *   node migrate.mjs --gpts             Only custom GPTs
 *   node migrate.mjs --convos           Only conversations
 *   node migrate.mjs --max-convos 100   Limit conversations processed
 *   node migrate.mjs --dry-run          Preview without writing files
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadJSON, getFlagValue, saveFile } from "./lib/utils.mjs";
import { transformMemories } from "./lib/transformers/memories.mjs";
import { transformInstructions } from "./lib/transformers/instructions.mjs";
import { transformGPTs } from "./lib/transformers/gpts.mjs";
import { transformConversations } from "./lib/transformers/conversations.mjs";
import { transformImplicitProfile, appendProfileToMemoryImport } from "./lib/transformers/implicit_profile.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    memoriesOnly: args.includes("--memories"),
    instructionsOnly: args.includes("--instructions"),
    gptsOnly: args.includes("--gpts"),
    convosOnly: args.includes("--convos"),
    profileOnly: args.includes("--profile"),
    dryRun: args.includes("--dry-run"),
    exportDir: getFlagValue(args, "--export-dir") || path.join(__dirname, "export"),
    outputDir: getFlagValue(args, "--output-dir") || path.join(__dirname, "claude-import"),
    maxConvos: parseInt(getFlagValue(args, "--max-convos") || "0", 10),
  };
}

function generateMasterClaudeMd(sections, opts) {
  let md = "# User Profile & Preferences\n\n";
  md += "*Auto-generated from ChatGPT data migration — ";
  md += new Date().toISOString().split("T")[0];
  md += "*\n\n";
  md += "---\n\n";

  // Quick Reference from implicit profile synthesis — goes at the very top
  if (sections.implicitProfile?.quickRefBlock) {
    md += sections.implicitProfile.quickRefBlock;
    md += "---\n\n";
  }

  if (sections.instructions?.claudeSection) {
    md += sections.instructions.claudeSection;
  }

  if (sections.memories?.claudeSection) {
    md += sections.memories.claudeSection;
  }

  if (sections.implicitProfile?.claudeSection) {
    md += sections.implicitProfile.claudeSection;
  }

  md += "\n---\n\n";
  md += "## How to use this file\n\n";
  md += "- **Claude Code**: Copy to `~/.claude/CLAUDE.md` for global memory, or into your project's CLAUDE.md\n";
  md += "- **claude.ai / mobile**: Use `memory-import.txt` — open Settings → Memory → and paste the content in\n";
  md += "- **Conversations**: Browse `conversations/by-topic/` or `conversations/by-date/` for your history\n";
  md += "- **Custom GPTs**: Each GPT is in `projects/<name>/CLAUDE.md` — use as a Project instruction in claude.ai\n";

  saveFile(path.join(opts.outputDir, "CLAUDE.md"), md, opts.dryRun);
}

function printSummary(report, opts) {
  console.log("\n🎉 Migration complete!\n");
  console.log(`   Output: ${opts.outputDir}\n`);

  if (report.memories) {
    console.log(`   Memories:       ${report.memories.total} items → memory-import.txt + CLAUDE.md`);
  }
  if (report.instructions) {
    const { aboutUserLen, aboutModelLen } = report.instructions;
    if (aboutUserLen || aboutModelLen) {
      console.log(`   Instructions:   about-user(${aboutUserLen}chars) + response-prefs(${aboutModelLen}chars) → CLAUDE.md`);
    }
  }
  if (report.gpts) {
    console.log(`   GPTs:           ${report.gpts.total} projects → projects/`);
  }
  if (report.conversations) {
    console.log(`   Conversations:  ${report.conversations.total} processed (${report.conversations.totalMessages || 0} messages) → conversations/`);
  }
  if (report.implicitProfile) {
    const qr = report.implicitProfile.quickReference?.length || 0;
    const pl = report.implicitProfile.profileLines?.length || 0;
    console.log(`   Implicit profile: ${qr} quick-ref bullets + ${pl} profile facts → CLAUDE.md + memory-import.txt`);
  }

  console.log("\n   Next steps:");
  console.log("   1. Copy claude-import/CLAUDE.md → ~/.claude/CLAUDE.md  (Claude Code)");
  console.log("   2. Open claude-import/memory-import.txt → paste into Claude app memory settings");
  console.log("   3. Upload conversation markdown files to Claude Projects for context");
  if (report.gpts?.total > 0) {
    console.log("   4. Each projects/<name>/CLAUDE.md → paste as Custom Instructions in claude.ai");
  }
  console.log();
}

async function main() {
  const opts = parseArgs();
  const isAll = !opts.memoriesOnly && !opts.instructionsOnly && !opts.gptsOnly && !opts.convosOnly && !opts.profileOnly;

  console.log("🚀 ChatGPT → Claude Migrator\n");
  if (opts.dryRun) console.log("   [dry-run mode — no files will be written]\n");
  console.log(`   Reading from: ${opts.exportDir}`);
  console.log(`   Writing to:   ${opts.outputDir}\n`);

  if (!fs.existsSync(opts.exportDir)) {
    console.error(`❌ Export directory not found: ${opts.exportDir}`);
    console.error("   Run  node export.mjs  first to export your ChatGPT data.\n");
    process.exit(1);
  }

  if (!opts.dryRun) {
    fs.mkdirSync(opts.outputDir, { recursive: true });
  }

  const report = {};

  if (isAll || opts.memoriesOnly) {
    console.log("📋 Transforming memories...");
    const memories = loadJSON(opts.exportDir, "memories.json");
    report.memories = await transformMemories(memories || [], opts);
  }

  if (isAll || opts.instructionsOnly) {
    console.log("📋 Transforming custom instructions...");
    const instructions = loadJSON(opts.exportDir, "custom_instructions.json");
    const userInfo = loadJSON(opts.exportDir, "user_info.json");
    report.instructions = await transformInstructions(instructions, userInfo, opts);
  }

  if (isAll || opts.gptsOnly) {
    console.log("📋 Transforming custom GPTs...");
    const gpts = loadJSON(opts.exportDir, "custom_gpts.json");
    report.gpts = await transformGPTs(gpts || [], opts);
  }

  if (isAll || opts.convosOnly) {
    console.log("📋 Transforming conversations...");
    report.conversations = await transformConversations(opts);
  }

  if (isAll || opts.profileOnly) {
    console.log("📋 Transforming implicit profile...");
    const profileData = loadJSON(opts.exportDir, "implicit_profile.json");
    if (profileData) {
      report.implicitProfile = await transformImplicitProfile(profileData, opts);

      // Append profile facts to memory-import.txt if it was already written
      const memoryImportPath = path.join(opts.outputDir, "memory-import.txt");
      if (!opts.dryRun && fs.existsSync(memoryImportPath) && report.implicitProfile.profileLines?.length > 0) {
        const existing = fs.readFileSync(memoryImportPath, "utf-8");
        const updated = appendProfileToMemoryImport(existing, report.implicitProfile.profileLines);
        fs.writeFileSync(memoryImportPath, updated);
        console.log(`  ✅ Appended ${report.implicitProfile.profileLines.length} profile facts to memory-import.txt`);
      } else if (report.implicitProfile.profileLines?.length > 0 && !report.memories) {
        // No existing memory-import.txt — create one with just profile facts
        let importText = "# Profile imported from ChatGPT implicit profile extraction\n\n";
        importText = appendProfileToMemoryImport(importText, report.implicitProfile.profileLines);
        saveFile(path.join(opts.outputDir, "memory-import.txt"), importText, opts.dryRun);
      }
    } else {
      console.log("  ⚠️  No implicit_profile.json found. Run  node export.mjs --profile  first.");
      report.implicitProfile = null;
    }
  }

  // Generate master CLAUDE.md when we have any content for it
  if (isAll || opts.memoriesOnly || opts.instructionsOnly || opts.profileOnly) {
    generateMasterClaudeMd(report, opts);
  }

  // Write migration report
  if (!opts.dryRun) {
    const metaDir = path.join(opts.outputDir, "metadata");
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(
      path.join(metaDir, "migration-report.json"),
      JSON.stringify({ timestamp: new Date().toISOString(), ...report }, null, 2)
    );
  }

  printSummary(report, opts);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
