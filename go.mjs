#!/usr/bin/env node
/**
 * go.mjs — ChatGPT → Claude migration tool
 *
 * Automatic mode (default):
 *   npm start          Exports everything, migrates, categorizes, uploads to Claude Projects
 *   node go.mjs        Same thing
 *
 * Interactive mode:
 *   npm run menu       Pick individual steps from a menu
 *   node go.mjs --menu
 *
 * Guides you through:
 *   1. Playwright setup (auto-installs chromium if missing)
 *   2. ChatGPT login (first time)
 *   3. Export everything from ChatGPT
 *   4. Convert to Claude format (CLAUDE.md, memory-import.txt, conversations)
 *   5. Categorize conversations into project bundles
 *   6. Upload to claude.ai Projects
 */

import { createInterface } from "readline";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// ANSI color helpers (work on Mac/Linux/Windows Terminal/PowerShell 7)
// ---------------------------------------------------------------------------
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
};

function paint(color, text) {
  return `${color}${text}${c.reset}`;
}

function header(text) {
  const line = "─".repeat(text.length + 4);
  console.log(`\n${paint(c.cyan, `┌${line}┐`)}`);
  console.log(`${paint(c.cyan, "│")}  ${paint(c.bold, text)}  ${paint(c.cyan, "│")}`);
  console.log(`${paint(c.cyan, `└${line}┘`)}\n`);
}

function info(text) {
  console.log(`  ${paint(c.blue, "ℹ")}  ${text}`);
}

function ok(text) {
  console.log(`  ${paint(c.green, "✓")}  ${text}`);
}

function warn(text) {
  console.log(`  ${paint(c.yellow, "⚠")}  ${text}`);
}

function err(text) {
  console.log(`  ${paint(c.red, "✗")}  ${text}`);
}

// ---------------------------------------------------------------------------
// readline prompt helpers
// ---------------------------------------------------------------------------

function rl() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

async function ask(question) {
  return new Promise((resolve) => {
    const iface = rl();
    iface.question(`\n  ${paint(c.cyan, "?")}  ${question} `, (answer) => {
      iface.close();
      resolve(answer.trim());
    });
  });
}

async function pressEnter(message = "Press Enter to continue...") {
  return ask(message);
}

// ---------------------------------------------------------------------------
// Run a command and stream its output (inherits stdio)
// ---------------------------------------------------------------------------

function runLive(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "inherit", shell: false });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Step 1 — Ensure Playwright chromium is installed
// ---------------------------------------------------------------------------

async function ensurePlaywright() {
  info("Checking Playwright chromium...");
  // Always attempt install — it's idempotent and fast if already installed
  info("Running  npx playwright install chromium  (fast if already installed)...");
  await runLive("npx", ["playwright", "install", "chromium"]);
  ok("Playwright chromium ready");
}

// ---------------------------------------------------------------------------
// Step 2 — Session detection
// ---------------------------------------------------------------------------

function hasSession() {
  const profileDir = path.join(__dirname, ".chatgpt-profile");
  return fs.existsSync(profileDir) && fs.readdirSync(profileDir).length > 0;
}

async function doLogin() {
  header("First-time login");
  info("Opening ChatGPT in a browser window.");
  info("Log in with your account, then come back here.");
  console.log();
  await runLive("node", ["export.mjs", "--login"]).catch(() => {});
  await pressEnter("Login complete? Press Enter to continue...");
}

async function doRelogin() {
  const profileDir = path.join(__dirname, ".chatgpt-profile");
  if (fs.existsSync(profileDir)) {
    warn("Clearing saved session...");
    fs.rmSync(profileDir, { recursive: true, force: true });
    ok("Session cleared.");
  }
  await doLogin();
}

// ---------------------------------------------------------------------------
// Step 3 — Main menu
// ---------------------------------------------------------------------------

const MENU = [
  {
    key: "1",
    label: "Full migration",
    desc: "Export everything (memories, instructions, GPTs, conversations, implicit profile) + convert to Claude",
    exportArgs: [],
    migrateArgs: [],
  },
  {
    key: "2",
    label: "Quick migration",
    desc: "Memories + custom instructions only (fastest)",
    exportArgs: ["--memories"],
    migrateArgs: ["--memories", "--instructions"],
  },
  {
    key: "3",
    label: "Export only",
    desc: "Raw JSON dump to export/ — no Claude conversion",
    exportArgs: [],
    migrateArgs: null,
  },
  {
    key: "4",
    label: "Migrate only",
    desc: "Already exported? Just convert to Claude format",
    exportArgs: null,
    migrateArgs: [],
  },
  {
    key: "5",
    label: "Implicit profile",
    desc: "14-prompt AI probing battery only — surfaces hidden patterns and preferences",
    exportArgs: ["--profile"],
    migrateArgs: ["--profile"],
  },
  {
    key: "6",
    label: "Re-login",
    desc: "Clear saved session and log in again",
    special: "relogin",
  },
  {
    key: "7",
    label: "Upload to Claude Projects",
    desc: "Categorize conversations + upload to claude.ai via browser automation",
    special: "claude-upload",
  },
];

function printMenu() {
  console.log(`\n  ${paint(c.bold, "What would you like to do?")}\n`);
  for (const item of MENU) {
    const key = paint(c.cyan + c.bold, `[${item.key}]`);
    const label = paint(c.bold, item.label);
    console.log(`    ${key}  ${label}`);
    console.log(`         ${paint(c.dim, item.desc)}`);
    console.log();
  }
}

async function runMenu() {
  while (true) {
    printMenu();
    const choice = await ask("Enter choice (1-7):");
    const item = MENU.find((m) => m.key === choice);

    if (!item) {
      warn("Invalid choice. Please enter 1-7.");
      continue;
    }

    if (item.special === "relogin") {
      await doRelogin();
      continue;
    }

    if (item.special === "claude-upload") {
      return item;
    }

    return item;
  }
}

// ---------------------------------------------------------------------------
// Step 4 — Run selected flow
// ---------------------------------------------------------------------------

async function runFlow(item) {
  console.log();

  if (item.special === "claude-upload") {
    // Run categorize first if manifest doesn't exist
    const manifestPath = path.join(__dirname, "claude-projects", "_manifest.json");
    if (!fs.existsSync(manifestPath)) {
      header("Categorizing conversations into project bundles");
      await runLive("node", ["categorize.mjs"]);
      ok("Categorization complete");
      console.log();
    } else {
      ok("Existing project bundles found — skipping categorization");
      console.log();
    }

    header("Uploading to Claude Projects");
    await runLive("node", ["upload.mjs"]);
    ok("Upload complete");
    console.log();
    return;
  }

  if (item.exportArgs !== null) {
    header(`Exporting from ChatGPT`);
    await runLive("node", ["export.mjs", ...item.exportArgs]);
    ok("Export complete");
    console.log();
  }

  if (item.migrateArgs !== null) {
    header(`Converting to Claude format`);
    await runLive("node", ["migrate.mjs", ...item.migrateArgs]);
    ok("Migration complete");
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Step 5 — Print next steps
// ---------------------------------------------------------------------------

function printNextSteps(item) {
  header("Done!");

  const outputDir = path.join(__dirname, "claude-import");
  const exportDir = path.join(__dirname, "export");

  console.log(`  ${paint(c.green + c.bold, "Next steps:")}\n`);

  let step = 1;

  if (item.migrateArgs !== null && fs.existsSync(path.join(outputDir, "CLAUDE.md"))) {
    console.log(
      `  ${paint(c.cyan, `${step}.`)}  Copy CLAUDE.md to your global Claude Code memory:`
    );
    console.log(`       ${paint(c.dim, "cp claude-import/CLAUDE.md ~/.claude/CLAUDE.md")}\n`);
    step++;

    console.log(
      `  ${paint(c.cyan, `${step}.`)}  Paste memories into claude.ai:`
    );
    console.log(`       ${paint(c.dim, "Open claude-import/memory-import.txt → copy → paste in Claude Settings → Memory")}\n`);
    step++;
  }

  if (item.exportArgs !== null && fs.existsSync(path.join(exportDir, "implicit_profile.json"))) {
    console.log(
      `  ${paint(c.cyan, `${step}.`)}  Review your implicit profile:`
    );
    console.log(`       ${paint(c.dim, "open claude-import/CLAUDE.md  (look for 'Quick Reference' at the top)")}\n`);
    step++;
  }

  if (fs.existsSync(path.join(outputDir, "conversations"))) {
    console.log(
      `  ${paint(c.cyan, `${step}.`)}  Browse conversation history:`
    );
    console.log(`       ${paint(c.dim, "open claude-import/conversations/by-topic/")}\n`);
  }

  console.log(
    `  ${paint(c.dim, "All output files are in:  " + outputDir)}`
  );
  console.log();
}

// ---------------------------------------------------------------------------
// Automatic mode — runs full pipeline end-to-end
// ---------------------------------------------------------------------------

async function runAutomatic() {
  header("ChatGPT → Claude  Full Migration");

  info(`Working directory: ${__dirname}\n`);

  // Step 1: Playwright
  await ensurePlaywright();
  console.log();

  // Step 2: ChatGPT login
  if (!hasSession()) {
    await doLogin();
  } else {
    ok("Saved ChatGPT session found");
  }
  console.log();

  // Step 3: Export everything from ChatGPT
  header("Step 1/4 — Exporting from ChatGPT");
  info("This extracts memories, instructions, GPTs, conversations, and your implicit profile.");
  info("Large accounts may take 10-30 minutes.\n");
  await runLive("node", ["export.mjs"]);
  ok("Export complete");
  console.log();

  // Step 4: Migrate to Claude format
  header("Step 2/4 — Converting to Claude format");
  info("Generating CLAUDE.md, memory-import.txt, and conversation markdown.\n");
  await runLive("node", ["migrate.mjs"]);
  ok("Migration complete");
  console.log();

  // Step 5: Categorize into project bundles
  header("Step 3/4 — Categorizing conversations into project bundles");
  info("Grouping conversations by topic for Claude Projects.\n");
  await runLive("node", ["categorize.mjs"]);
  ok("Categorization complete");
  console.log();

  // Step 6: Upload to Claude Projects
  header("Step 4/4 — Uploading to Claude Projects");
  info("Creating projects on claude.ai and uploading conversation files.\n");
  await runLive("node", ["upload.mjs"]);
  ok("Upload complete");
  console.log();

  // Final summary
  printAutoSummary();
}

function printAutoSummary() {
  header("Migration Complete!");

  const outputDir = path.join(__dirname, "claude-import");
  const projectsDir = path.join(__dirname, "claude-projects");

  // Count what was created
  let convoCount = 0;
  const byDateDir = path.join(outputDir, "conversations", "by-date");
  if (fs.existsSync(byDateDir)) {
    const months = fs.readdirSync(byDateDir).filter((d) => !d.startsWith("."));
    for (const m of months) {
      const files = fs.readdirSync(path.join(byDateDir, m)).filter((f) => f.endsWith(".md"));
      convoCount += files.length;
    }
  }

  let bundleCount = 0;
  const manifestPath = path.join(projectsDir, "_manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    bundleCount = manifest.bundles?.length || 0;
  }

  console.log(`  ${paint(c.green + c.bold, "What was created:")}\n`);

  if (fs.existsSync(path.join(outputDir, "CLAUDE.md"))) {
    console.log(`  ${paint(c.cyan, "CLAUDE.md")}           Your profile, memories, and preferences for Claude Code`);
  }
  if (fs.existsSync(path.join(outputDir, "memory-import.txt"))) {
    console.log(`  ${paint(c.cyan, "memory-import.txt")}   Memories formatted for claude.ai Settings → Memory`);
  }
  if (convoCount > 0) {
    console.log(`  ${paint(c.cyan, `${convoCount} conversations`)}   Organized by date and topic in markdown`);
  }
  if (bundleCount > 0) {
    console.log(`  ${paint(c.cyan, `${bundleCount} Claude Projects`)}  Uploaded to claude.ai with conversation files`);
  }

  console.log(`\n  ${paint(c.green + c.bold, "Set up Claude Code (one-time):")}\n`);
  console.log(`  ${paint(c.cyan, "1.")}  Copy your profile to Claude Code's global memory:\n`);
  console.log(`     ${paint(c.bold, "cp claude-import/CLAUDE.md ~/.claude/CLAUDE.md")}\n`);
  console.log(`     This gives Claude Code your preferences, skills, and working style`);
  console.log(`     in every session, across all projects.\n`);

  console.log(`  ${paint(c.green + c.bold, "Set up claude.ai memories (one-time):")}\n`);
  console.log(`  ${paint(c.cyan, "2.")}  Open ${paint(c.bold, "claude-import/memory-import.txt")}`);
  console.log(`     Copy the contents → go to claude.ai → Settings → Memory → paste\n`);

  console.log(`  ${paint(c.green + c.bold, "To update later (pick up new ChatGPT conversations):")}\n`);
  console.log(`  ${paint(c.cyan, "3.")}  Re-run anytime to export new conversations and update everything:\n`);
  console.log(`     ${paint(c.bold, "npm start")}\n`);
  console.log(`     This will re-export from ChatGPT, re-migrate, re-categorize,`);
  console.log(`     and upload any new project bundles. Already-uploaded projects`);
  console.log(`     are skipped automatically.\n`);

  console.log(`  ${paint(c.dim, "Individual steps:")}`);
  console.log(`  ${paint(c.dim, "  npm run export      Just re-export from ChatGPT")}`);
  console.log(`  ${paint(c.dim, "  npm run migrate     Just re-convert to Claude format")}`);
  console.log(`  ${paint(c.dim, "  npm run categorize  Just re-categorize conversations")}`);
  console.log(`  ${paint(c.dim, "  npm run upload      Just upload pending bundles")}`);
  console.log(`  ${paint(c.dim, "  npm run menu        Interactive menu with all options")}`);
  console.log(`  ${paint(c.dim, "  npm run search      Search your conversation history")}`);
  console.log();

  console.log(`  ${paint(c.dim, "All output files:  " + outputDir)}`);
  if (bundleCount > 0) {
    console.log(`  ${paint(c.dim, "Project bundles:   " + projectsDir)}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const INTERACTIVE = process.argv.includes("--menu");

async function main() {
  if (!INTERACTIVE) {
    await runAutomatic();
    return;
  }

  // Interactive menu mode
  header("ChatGPT → Claude Migration Wizard");

  info(`Working directory: ${__dirname}\n`);

  // Step 1: Ensure Playwright is ready
  await ensurePlaywright();
  console.log();

  // Step 2: Session check
  if (!hasSession()) {
    await doLogin();
  } else {
    ok("Saved ChatGPT session found");
  }

  // Step 3: Menu
  const item = await runMenu();

  // Step 4: Run
  try {
    await runFlow(item);
  } catch (e) {
    err(`Flow failed: ${e.message}`);
    process.exit(1);
  }

  // Step 5: Next steps
  printNextSteps(item);
}

main().catch((e) => {
  err(`Fatal: ${e.message}`);
  process.exit(1);
});
