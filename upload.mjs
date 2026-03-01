#!/usr/bin/env node
/**
 * upload.mjs — Playwright uploader for claude.ai Projects
 *
 * Automates: login → create project → upload files → repeat per bundle.
 * Uses Playwright's bundled Chromium (same as export.mjs for ChatGPT).
 *
 * Usage:
 *   node upload.mjs              # Upload all pending bundles
 *   node upload.mjs --login      # Just log in to claude.ai (manual)
 *   node upload.mjs --bundle 03  # Upload only bundle starting with "03"
 *   node upload.mjs --verify     # Verify uploaded projects
 *   node upload.mjs --dry-run    # Preview what would be uploaded
 */

import { chromium } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, ".claude-profile");
const PROJECTS_DIR = path.join(__dirname, "claude-projects");
const MANIFEST_PATH = path.join(PROJECTS_DIR, "_manifest.json");

const args = process.argv.slice(2);
const LOGIN_ONLY = args.includes("--login");
const VERIFY_ONLY = args.includes("--verify");
const DRY_RUN = args.includes("--dry-run");

// Parse --bundle flag
const BUNDLE_FILTER = (() => {
  const idx = args.indexOf("--bundle");
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
})();

const BASE_URL = "https://claude.ai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error("❌ No manifest found at", MANIFEST_PATH);
    console.error("   Run categorize first:  node categorize.mjs");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// ---------------------------------------------------------------------------
// Ensure Playwright Chromium is installed
// ---------------------------------------------------------------------------

function ensureChromium() {
  console.log("  Checking Playwright chromium...");
  try {
    execSync("npx playwright install chromium", { stdio: "inherit" });
  } catch {
    console.error("❌ Failed to install Playwright chromium");
    process.exit(1);
  }
  console.log("  ✅ Playwright chromium ready\n");
}

// ---------------------------------------------------------------------------
// Launch browser with persistent profile (separate from .chatgpt-profile)
// ---------------------------------------------------------------------------

async function launchBrowser() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  // Use existing page or create new one
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

// ---------------------------------------------------------------------------
// Login detection — modeled after export.mjs's proven approach
//
// claude.ai redirects to login.anthropic.com or accounts.google.com for auth.
// We stay completely passive during auth — no page.evaluate(), no polling.
// Just check the URL periodically until we're back on claude.ai with the
// chat UI visible.
// ---------------------------------------------------------------------------

function isOnClaudeApp(url) {
  return (
    url.includes("claude.ai") &&
    !url.includes("/login") &&
    !url.includes("/oauth") &&
    !url.includes("/auth") &&
    !url.includes("/callback") &&
    !url.includes("/signup")
  );
}

/**
 * Wait until claude.ai chat UI is ready.
 * Handles auth redirects (Google, SSO, email) gracefully — stays hands-off
 * while user completes login in the browser.
 */
async function waitForClaudeReady(page, { timeoutMs = 300_000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  } catch (err) {
    // Navigation may be interrupted by auth redirects — that's expected
    if (!err.message.includes("interrupted") && !err.message.includes("ERR_ABORTED")) {
      throw err;
    }
  }

  // Selectors that indicate claude.ai is ready (chat or projects page)
  const readySelectors = [
    '[contenteditable="true"]',          // Chat composer
    'div[class*="ProseMirror"]',         // ProseMirror editor
    'a[href*="/projects"]',              // Projects nav link
    'button[aria-label*="New chat"]',    // New chat button
    '[data-testid="chat-input"]',        // Chat input
  ].join(", ");

  let printedAuthMsg = false;

  while (Date.now() < deadline) {
    const url = page.url();

    if (!isOnClaudeApp(url)) {
      // On an auth page — print once, then sleep. Completely passive.
      if (!printedAuthMsg) {
        console.log("  ⏳ Auth redirect detected — complete login in the browser window");
        console.log(`     (current: ${url.split("?")[0]})`);
        printedAuthMsg = true;
      }
      await sleep(3000);
      continue;
    }

    // We're on claude.ai — look for UI elements that confirm we're logged in
    try {
      await page.waitForSelector(readySelectors, {
        timeout: Math.min(deadline - Date.now(), 8000),
      });
    } catch {
      // Selector not found yet — might still be loading or redirecting
      await sleep(2000);
      continue;
    }

    // Stabilize: wait 2s then confirm we're still on claude.ai
    await sleep(2000);
    if (isOnClaudeApp(page.url())) {
      return true;
    }
    // Redirected during stabilization — keep waiting
    console.log("  ⏳ Page changed during stabilization, retrying...");
  }

  throw new Error(
    "Timed out waiting for claude.ai to be ready. " +
    "Please complete login in the browser window."
  );
}

// ---------------------------------------------------------------------------
// Login flow
// ---------------------------------------------------------------------------

async function doLogin() {
  console.log("\n🔐 Opening claude.ai for login...\n");
  console.log("  A Chromium browser window will open.");
  console.log("  Log in to your Claude account (Google, email, etc.).");
  console.log("  The script will detect when you're logged in.\n");

  ensureChromium();

  const { context, page } = await launchBrowser();

  try {
    await waitForClaudeReady(page, { timeoutMs: 300_000 });
    console.log("\n  ✅ Login successful! Session saved to .claude-profile/");
    console.log("  You can now run:  node upload.mjs\n");
  } catch (err) {
    console.log(`\n  ⚠ ${err.message}`);
    console.log("  Session may still have been saved. Try:  node upload.mjs\n");
  }

  await context.close();
}

// ---------------------------------------------------------------------------
// Ensure logged in (for upload/verify modes)
// ---------------------------------------------------------------------------

async function ensureLoggedIn(page) {
  console.log("  ⏳ Checking claude.ai login...");

  try {
    await waitForClaudeReady(page, { timeoutMs: 180_000 });
    console.log("  ✅ Logged in to claude.ai\n");
    return true;
  } catch {
    console.log("\n  ⚠ Not logged in. Run login first:\n");
    console.log("    node upload.mjs --login\n");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Upload a single bundle
// ---------------------------------------------------------------------------

async function uploadBundle(page, bundle) {
  const bundleDir = path.join(PROJECTS_DIR, bundle.dirName);

  console.log(`\n  📦 Uploading: ${bundle.projectName}`);
  console.log(`     ${bundle.fileCount} files, ~${Math.round(bundle.estimatedTokens / 1000)}k tokens`);

  if (DRY_RUN) {
    console.log("     [dry-run] Skipped.\n");
    return true;
  }

  try {
    // Step 1: Navigate to projects page
    await page.goto(`${BASE_URL}/projects`, { waitUntil: "domcontentloaded" });
    await sleep(3000);

    // Step 2: Click "New project" button (use header one to avoid strict mode violation)
    const newProjectBtn = page.getByTestId("page-header").getByRole("button", { name: /new project/i });
    await newProjectBtn.waitFor({ timeout: 10_000 });
    await newProjectBtn.click();

    // Wait for the create form to load
    await page.waitForURL("**/projects/create", { timeout: 10_000 });
    await sleep(2000);

    // Step 3: Fill project name (click + keyboard.type — .fill() times out on this input)
    const nameInput = page.locator('input[name="name"]');
    await nameInput.waitFor({ timeout: 10_000 });
    await nameInput.click();
    await sleep(300);
    await page.keyboard.type(bundle.projectName, { delay: 20 });
    await sleep(500);

    // Step 4: Fill description
    const descInput = page.locator('textarea[name="description"]');
    try {
      await descInput.click({ timeout: 3000 });
      await sleep(300);
      await page.keyboard.type(
        `${bundle.fileCount} exported ChatGPT conversations — ${bundle.topic}`,
        { delay: 10 }
      );
      await sleep(500);
    } catch {
      // Description field may not exist in some UI versions
    }

    // Step 5: Click "Create project" to create it
    const createBtn = page.getByRole("button", { name: /create project/i });
    await createBtn.waitFor({ timeout: 5000 });
    await createBtn.click();

    // Wait for project page to load (URL changes to /project/<uuid>)
    await page.waitForURL("**/project/**", { timeout: 15_000 });
    await sleep(3000);
    console.log(`     Project created: ${page.url()}`);

    // Step 6: Gather files to upload (skip _metadata files)
    const filePaths = [];
    const entries = fs.readdirSync(bundleDir);
    for (const entry of entries) {
      if (entry.startsWith("_")) continue;
      filePaths.push(path.join(bundleDir, entry));
    }

    if (filePaths.length === 0) {
      console.log("     ⚠ No files to upload in this bundle.");
      return true;
    }

    // Step 7: Click "Add files" button (the + next to "Files" in the sidebar)
    const addFilesBtn = page.locator('button[aria-label="Add files"]');
    await addFilesBtn.waitFor({ timeout: 10_000 });
    await addFilesBtn.click();
    await sleep(1500);

    // Step 8: Find the knowledge-base file input (NOT the chat file input)
    // The knowledge file input is the hidden one that accepts .md files
    // The chat input has id="chat-input-file-upload-onpage" — skip that one
    const fileInput = page.locator('input[type="file"]:not(#chat-input-file-upload-onpage)').first();
    await fileInput.waitFor({ state: "attached", timeout: 10_000 });

    // Step 9: Upload files via setInputFiles
    // Upload all at once — the input supports multiple files
    await fileInput.setInputFiles(filePaths);
    console.log(`     Uploading ${filePaths.length} files...`);

    // Wait for uploads to process — longer for bigger bundles
    const waitMs = Math.max(5000, filePaths.length * 500);
    console.log(`     Waiting ${Math.round(waitMs / 1000)}s for uploads to process...`);
    await sleep(waitMs);

    // Step 10: Verify file count on the project page
    // After upload, files should appear in the sidebar Files section
    try {
      // Reload to see final state
      await page.reload({ waitUntil: "domcontentloaded" });
      await sleep(3000);

      // Count file entries in the sidebar
      const fileItems = await page.evaluate(() => {
        // Files show as items in the sidebar under "Files" heading
        const items = document.querySelectorAll('[class*="file"], [data-testid*="file"]');
        return items.length;
      });
      if (fileItems > 0) {
        console.log(`     Verified: ${fileItems} files visible on project page`);
      }
    } catch {
      // Verification is best-effort
    }

    console.log(`     ✅ Upload complete: ${filePaths.length} files`);
    return true;
  } catch (error) {
    console.error(`     ❌ Upload failed: ${error.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Verify uploads
// ---------------------------------------------------------------------------

async function verifyUploads(page, manifest) {
  console.log("\n🔍 Verifying uploaded projects...\n");

  await page.goto(`${BASE_URL}/projects`, { waitUntil: "domcontentloaded" });
  await sleep(3000);

  const completedBundles = manifest.bundles.filter((b) => b.uploadStatus === "complete");
  console.log(`  ${completedBundles.length} bundles marked complete in manifest.\n`);

  for (const bundle of completedBundles) {
    // Check if project name appears on the page
    const projectLink = page.getByText(bundle.projectName).first();
    try {
      await projectLink.waitFor({ timeout: 3000 });
      console.log(`  ✅ ${bundle.projectName}`);
    } catch {
      console.log(`  ❌ ${bundle.projectName} — NOT FOUND on projects page`);
    }
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Login-only mode
  if (LOGIN_ONLY) {
    await doLogin();
    return;
  }

  const manifest = loadManifest();

  // Filter bundles
  let bundles = manifest.bundles;
  if (BUNDLE_FILTER) {
    bundles = bundles.filter((b) => b.dirName.startsWith(BUNDLE_FILTER));
    if (bundles.length === 0) {
      console.error(`❌ No bundles matching "${BUNDLE_FILTER}"`);
      process.exit(1);
    }
  }

  // Filter to pending only (unless verify mode)
  if (!VERIFY_ONLY) {
    const pending = bundles.filter((b) => b.uploadStatus !== "complete");
    if (pending.length === 0) {
      console.log("\n✅ All bundles already uploaded!\n");
      return;
    }
    bundles = pending;
  }

  console.log(`\n📤 ${VERIFY_ONLY ? "Verifying" : "Uploading"} ${bundles.length} bundle(s)...\n`);

  if (DRY_RUN) {
    for (const b of bundles) {
      console.log(`  [dry-run] Would upload: ${b.projectName} (${b.fileCount} files, ~${Math.round(b.estimatedTokens / 1000)}k tokens)`);
    }
    console.log();
    return;
  }

  // Ensure chromium is available
  ensureChromium();

  // Launch browser
  const { context, page } = await launchBrowser();

  // Ensure we're logged in (will wait for auth if needed)
  const loggedIn = await ensureLoggedIn(page);
  if (!loggedIn) {
    await context.close();
    process.exit(1);
  }

  if (VERIFY_ONLY) {
    await verifyUploads(page, manifest);
    await context.close();
    return;
  }

  // Upload each bundle
  for (let i = 0; i < bundles.length; i++) {
    const bundle = bundles[i];
    const success = await uploadBundle(page, bundle);

    if (success) {
      // Update manifest
      const manifestBundle = manifest.bundles.find((b) => b.dirName === bundle.dirName);
      if (manifestBundle) {
        manifestBundle.uploadStatus = "complete";
        manifestBundle.uploadedAt = new Date().toISOString();
        saveManifest(manifest);
        console.log(`     ✏️  Manifest updated: ${bundle.dirName} → complete`);
      }
    }

    // Delay between projects
    if (i < bundles.length - 1) {
      console.log("     ⏳ Waiting 5s before next bundle...");
      await sleep(5000);
    }
  }

  await context.close();

  // Final summary
  const completed = manifest.bundles.filter((b) => b.uploadStatus === "complete").length;
  const total = manifest.bundles.length;
  console.log(`\n📊 Progress: ${completed}/${total} bundles uploaded`);

  if (completed === total) {
    console.log("🎉 All bundles uploaded successfully!\n");
  } else {
    console.log(`   Run again to resume remaining ${total - completed} bundle(s).\n`);
  }
}

main().catch((e) => {
  console.error(`\n❌ Fatal: ${e.message}\n`);
  process.exit(1);
});
