#!/usr/bin/env node
/**
 * ChatGPT Full Exporter — Playwright script
 *
 * Extracts:
 *   1. Memories
 *   2. Custom Instructions / Personalization
 *   3. Conversation list (titles, IDs, timestamps)
 *   4. Full conversation contents (messages) via internal API
 *   5. Account / user profile info
 *
 * Uses a persistent Chromium profile so you only need to log in once.
 *
 * Usage:
 *   node export.mjs              # Run full export
 *   node export.mjs --login      # Just open the browser to log in, then quit
 *   node export.mjs --memories   # Only export memories
 *   node export.mjs --convos     # Only export conversations
 *   node export.mjs --profile    # Only run implicit profile extraction (14-prompt battery)
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sanitizeFilename } from "./lib/utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, ".chatgpt-profile");
const OUTPUT_DIR = path.join(__dirname, "export");
const BASE = "https://chatgpt.com";

const args = process.argv.slice(2);
const LOGIN_ONLY = args.includes("--login");
const MEMORIES_ONLY = args.includes("--memories");
const CONVOS_ONLY = args.includes("--convos");
const ARCHIVED_ONLY = args.includes("--archived");
const PROFILE_ONLY = args.includes("--profile");
const FULL = !MEMORIES_ONLY && !CONVOS_ONLY && !LOGIN_ONLY && !ARCHIVED_ONLY && !PROFILE_ONLY;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function save(name, data) {
  const file = path.join(OUTPUT_DIR, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`  ✅ Saved ${file} (${Array.isArray(data) ? data.length + " items" : "object"})`);
}

// ---------------------------------------------------------------------------
// Launch browser with persistent profile
// ---------------------------------------------------------------------------
async function launch() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

// ---------------------------------------------------------------------------
// Navigate to ChatGPT and wait for the chat UI to be ready.
// Handles auth redirects (2FA, email verification, re-login) gracefully.
//
// IMPORTANT: While the user is on auth.openai.com we stay completely hands-off
// — no page.evaluate(), no polling. We use Playwright's passive waitForURL()
// and waitForSelector() so the auth/2FA flow is never disturbed.
// ---------------------------------------------------------------------------
function isOnChatPage(url) {
  // Must be on chatgpt.com but NOT on an auth callback or intermediate URL
  return (
    url.startsWith(BASE) &&
    !url.includes("/auth") &&
    !url.includes("/callback") &&
    !url.includes("/login") &&
    !url.includes("/email-verification")
  );
}

async function waitForChatReady(page, { timeoutMs = 180_000, message = "", navigate = true } = {}) {
  const deadline = Date.now() + timeoutMs;

  if (navigate) {
    try {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
    } catch (err) {
      if (!err.message.includes("interrupted") && !err.message.includes("ERR_ABORTED")) {
        throw err;
      }
    }
  }

  // Selector for detecting chat readiness. We avoid generic 'textarea' since
  // ChatGPT has a hidden fallback <textarea> that matches even when the real
  // contenteditable composer isn't ready yet.
  const composerSelector = [
    "#prompt-textarea",
    '[id="composer-background"]',
    'div[contenteditable="true"][id="prompt-textarea"]',
  ].join(", ");

  // Simple, reliable loop: check URL → wait for composer → confirm stable.
  // While on an auth page, sleep briefly and re-check. No waitForNavigation
  // (which can hang if the navigation already happened), no JS injection.
  let loopCount = 0;
  while (Date.now() < deadline) {
    const url = page.url();
    loopCount++;

    if (!isOnChatPage(url)) {
      // On an auth page — print once, then sleep and re-check the URL.
      // Completely passive: no page.evaluate, no waitForNavigation.
      console.log(message || "  ⏳ Waiting for login — complete auth in the browser...");
      console.log(`     (current URL: ${url.split("?")[0]})`);
      message = ""; // only print the detail message once
      await page.waitForTimeout(3000);
      continue;
    }

    if (loopCount <= 3) {
      console.log(`  🔍 On ${url.split("?")[0]} — looking for chat composer...`);
    }

    // On chatgpt.com — try to find the composer
    try {
      await page.waitForSelector(composerSelector, {
        timeout: Math.min(deadline - Date.now(), 10_000),
      });
    } catch {
      console.log(`  ⏳ Composer not found yet, retrying... (${url.split("?")[0]})`);
      continue; // composer not found yet — loop
    }

    // Stabilization: wait 3s, then confirm we're still here
    await page.waitForTimeout(3000);

    if (isOnChatPage(page.url()) && (await page.$(composerSelector))) {
      return true;
    }
    // Redirected after stabilization — loop back
    console.log(`  ⏳ Page changed during stabilization, retrying...`);
  }

  throw new Error("Timed out waiting for ChatGPT chat UI. " + "Please complete login, 2FA, or email verification in the browser.");
}

// ---------------------------------------------------------------------------
// Wait until logged in (detect the main chat UI)
// ---------------------------------------------------------------------------
async function ensureLoggedIn(page) {
  console.log("⏳ Waiting for ChatGPT to be ready (log in if needed — 2FA may take a moment)...");
  await waitForChatReady(page, {
    timeoutMs: 180_000,
    message: "Auth redirect detected — log in and complete 2FA/email verification in the browser...",
  });
  console.log("✅ Logged in to ChatGPT\n");
}

// ---------------------------------------------------------------------------
// Helper: fetch the ChatGPT access token from the session endpoint.
// ChatGPT's backend API requires Authorization: Bearer <token> — cookies alone
// return 401 on most endpoints.
// ---------------------------------------------------------------------------
let _cachedAccessToken = null;

async function getAccessToken(page) {
  if (_cachedAccessToken) return _cachedAccessToken;

  // Primary: /api/auth/session returns { accessToken, ... }
  const token = await page.evaluate(async () => {
    try {
      const res = await fetch("/api/auth/session", { credentials: "include" });
      if (!res.ok) return null;
      const data = await res.json();
      return data.accessToken || null;
    } catch {
      return null;
    }
  });

  if (token) {
    _cachedAccessToken = token;
    console.log("  ✅ Obtained access token for API calls");
    return token;
  }

  // Fallback: try to grab it from __NEXT_DATA__ or window.__session
  const fallbackToken = await page.evaluate(() => {
    // Some builds expose it on __NEXT_DATA__
    try {
      const nd = window.__NEXT_DATA__;
      if (nd?.props?.pageProps?.accessToken) return nd.props.pageProps.accessToken;
    } catch {}
    // Or __session
    try {
      if (window.__session?.accessToken) return window.__session.accessToken;
    } catch {}
    return null;
  });

  if (fallbackToken) {
    _cachedAccessToken = fallbackToken;
    return fallbackToken;
  }

  console.log("  ⚠️  Could not obtain access token — API calls may fail with 401");
  return null;
}

// ---------------------------------------------------------------------------
// Helper: call ChatGPT's internal backend API using Bearer token + cookies.
// On 401, clears the cached token, re-fetches it, and retries once.
// ---------------------------------------------------------------------------
async function apiGet(page, endpoint) {
  const token = await getAccessToken(page);

  const doFetch = (bearerToken) =>
    page.evaluate(
      async ({ url, bt }) => {
        const headers = {};
        if (bt) headers["Authorization"] = `Bearer ${bt}`;
        const res = await fetch(url, { credentials: "include", headers });
        if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
        return res.json();
      },
      { url: `${BASE}/backend-api${endpoint}`, bt: bearerToken },
    );

  try {
    return await doFetch(token);
  } catch (err) {
    // On 401, refresh token and retry once
    if (err.message?.includes("401") && token) {
      _cachedAccessToken = null;
      const freshToken = await getAccessToken(page);
      if (freshToken && freshToken !== token) {
        return doFetch(freshToken);
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 1. Export Memories
// ---------------------------------------------------------------------------
// 1. Export Memories  (paginated API → UI scrape fallback → scroll fallback)
// ---------------------------------------------------------------------------
async function exportMemories(page) {
  console.log("📝 Exporting memories...");
  try {
    const memories = await exportMemoriesAPI(page);
    if (memories.length > 0) {
      save("memories.json", memories);
      return memories;
    }
    // API returned empty — might be disabled or restructured; try UI
    console.log("  ⚠️  API returned 0 memories, trying UI scrape as confirmation...");
    return exportMemoriesUI(page);
  } catch (err) {
    console.log(`  ⚠️  API approach failed (${err.message}), trying UI scrape...`);
    return exportMemoriesUI(page);
  }
}

async function exportMemoriesAPI(page) {
  const allMemories = [];
  const pageSize = 100;
  let cursor = null;
  let page_num = 0;

  while (true) {
    const qs = cursor ? `?limit=${pageSize}&cursor=${encodeURIComponent(cursor)}` : `?limit=${pageSize}`;

    const data = await apiGet(page, `/memories${qs}`);

    // Handle various response shapes OpenAI has used
    const items = data.memories || data.results || data.items || (Array.isArray(data) ? data : []);

    for (const m of items) {
      const text = m.content || m.value || m.text || m.memory || "";
      if (text.trim()) {
        allMemories.push({
          id: m.id,
          content: text.trim(),
          created_at: m.created_at,
          updated_at: m.updated_at,
          source: m.source,
        });
      }
    }

    console.log(`  ... fetched ${allMemories.length} memories so far`);

    // Pagination: cursor-based or offset-based
    cursor = data.cursor || data.next_cursor || data.after || null;
    const hasMore = data.has_more ?? (items.length === pageSize && cursor);
    if (!hasMore || !cursor) break;

    page_num++;
    await page.waitForTimeout(2000);

    // Safety valve — shouldn't need more than 50 pages of 100
    if (page_num > 50) {
      console.log("  ⚠️  Hit pagination safety limit (5000 memories). Stopping.");
      break;
    }
  }

  return allMemories;
}

async function exportMemoriesUI(page) {
  try {
    // Navigate to settings → personalization → memory
    await page.goto(`${BASE}/#settings/Personalization`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Try clicking "Manage" button for memories
    const manageBtn = await page.$('button:has-text("Manage")');
    if (manageBtn) await manageBtn.click();
    await page.waitForTimeout(2000);

    // Scroll the memory list to load all items (it may be virtualized)
    await autoScroll(page, '[role="dialog"], [class*="modal"]');

    // Scrape all memory items — try multiple selector strategies
    const memories = await page.evaluate(() => {
      const seen = new Set();
      const items = [];

      function addText(text) {
        const t = text.trim();
        if (t.length > 5 && t.length < 1000 && !seen.has(t)) {
          seen.add(t);
          items.push({ content: t });
        }
      }

      // Strategy 1: data-testid
      document.querySelectorAll('[data-testid*="memory"]').forEach((el) => addText(el.textContent));

      // Strategy 2: aria-label containing "memory"
      document.querySelectorAll('[aria-label*="emory"]').forEach((el) => addText(el.textContent));

      // Strategy 3: list items inside any open dialog/modal
      if (items.length === 0) {
        const container = document.querySelector('[role="dialog"], [class*="modal"], [class*="Memory"]');
        if (container) {
          container.querySelectorAll("li, [role='listitem']").forEach((el) => addText(el.textContent));
        }
      }

      // Strategy 4: generic paragraph/div children of dialog with reasonable length
      if (items.length === 0) {
        const container = document.querySelector('[role="dialog"]');
        if (container) {
          container.querySelectorAll("div > p, div > span").forEach((el) => {
            const t = el.textContent.trim();
            if (t.length > 10 && t.length < 500 && el.children.length === 0) addText(t);
          });
        }
      }

      return items;
    });

    // Navigate back to main chat
    await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(2000);

    if (memories.length > 0) {
      console.log(`  ✅ UI scrape found ${memories.length} memories`);
      save("memories.json", memories);
    } else {
      console.log("  ⚠️  No memories found via UI scrape.");
      console.log("     → Open chatgpt.com → Settings → Personalization → Manage memories");
      console.log("     → Copy all text and save manually to export/memories.json");
      save("memories.json", []);
    }
    return memories;
  } catch (err) {
    console.log(`  ⚠️  UI scrape also failed: ${err.message}`);
    // Navigate back to main chat
    await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(2000);
    save("memories.json", []);
    return [];
  }
}

// Scrolls a container to the bottom to force lazy-loaded items to render
async function autoScroll(page, containerSelector) {
  try {
    await page.evaluate(async (sel) => {
      const el = document.querySelector(sel) || document.scrollingElement;
      await new Promise((resolve) => {
        let last = -1;
        const tick = () => {
          el.scrollTop += 400;
          if (el.scrollTop === last) return resolve();
          last = el.scrollTop;
          setTimeout(tick, 150);
        };
        tick();
      });
    }, containerSelector);
    await page.waitForTimeout(500);
  } catch {
    // Non-fatal — continue with whatever loaded
  }
}

// ---------------------------------------------------------------------------
// 2. Export Custom Instructions / Personalization
// ---------------------------------------------------------------------------
async function exportCustomInstructions(page) {
  console.log("📝 Exporting custom instructions...");

  const endpoints = ["/user_system_messages", "/personalization", "/user_system_messages/latest"];

  for (const endpoint of endpoints) {
    try {
      const data = await apiGet(page, endpoint);
      // Check if we actually got content (not just an empty shell)
      const hasContent =
        data &&
        (data.about_user_message ||
          data.about_model_message ||
          data.custom_instructions ||
          data.user_instructions ||
          Object.keys(data).length > 2);
      if (hasContent) {
        save("custom_instructions.json", data);
        return data;
      }
    } catch {
      // Try next
    }
  }

  // Fallback: scrape from Settings UI
  console.log("  ⚠️  API failed — trying UI scrape from Settings...");
  try {
    await page.goto(`${BASE}/#settings/Personalization`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const instructions = await page.evaluate(() => {
      const textareas = document.querySelectorAll("textarea");
      const result = {};
      textareas.forEach((ta, i) => {
        const val = ta.value?.trim();
        if (val) {
          // First textarea is usually "What would you like ChatGPT to know about you?"
          // Second is "How would you like ChatGPT to respond?"
          if (i === 0) result.about_user_message = val;
          else if (i === 1) result.about_model_message = val;
          else result[`field_${i}`] = val;
        }
      });
      return result;
    });

    if (Object.keys(instructions).length > 0) {
      console.log("  ✅ Scraped custom instructions from Settings UI");
      save("custom_instructions.json", instructions);
      // Navigate back to main chat
      await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(2000);
      return instructions;
    }

    // Navigate back
    await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(2000);
  } catch (err) {
    console.log(`  ⚠️  UI scrape failed: ${err.message}`);
  }

  save("custom_instructions.json", {});
  return {};
}

// ---------------------------------------------------------------------------
// 3. Export User / Account Info
// ---------------------------------------------------------------------------
async function exportUserInfo(page) {
  console.log("📝 Exporting user info...");
  try {
    const [me, settings] = await Promise.all([
      apiGet(page, "/me").catch(() => null),
      apiGet(page, "/settings/user").catch(() => null),
    ]);
    const combined = { me, settings };
    save("user_info.json", combined);
    return combined;
  } catch (err) {
    console.log(`  ⚠️  Could not fetch user info (${err.message})`);
    save("user_info.json", {});
    return {};
  }
}

// ---------------------------------------------------------------------------
// 4. Export Model Preferences / Config
// ---------------------------------------------------------------------------
async function exportModelConfig(page) {
  console.log("📝 Exporting model config & preferences...");
  try {
    const [models, accountInfo] = await Promise.all([
      apiGet(page, "/models").catch(() => null),
      apiGet(page, "/accounts/check").catch(() => null),
    ]);
    const data = { models, account: accountInfo };
    save("model_config.json", data);
    return data;
  } catch (err) {
    console.log(`  ⚠️  Could not fetch model config (${err.message})`);
    save("model_config.json", {});
    return {};
  }
}

// ---------------------------------------------------------------------------
// 5. Export Conversation List + Full Contents
// ---------------------------------------------------------------------------
async function exportConversations(page) {
  console.log("📝 Exporting conversation list...");

  let allConvos = [];
  let offset = 0;
  const limit = 100;

  // Paginate through all conversations
  while (true) {
    try {
      const data = await apiGet(page, `/conversations?offset=${offset}&limit=${limit}&order=updated`);
      const items = data.items || [];
      if (items.length === 0) break;

      allConvos = allConvos.concat(items);
      console.log(`  ... fetched ${allConvos.length} conversations so far`);

      if (items.length < limit || allConvos.length >= (data.total || Infinity)) break;
      offset += limit;

      // Small delay to avoid rate limiting
      await page.waitForTimeout(2000);
    } catch (err) {
      console.log(`  ⚠️  Error fetching conversation list at offset ${offset}: ${err.message}`);
      break;
    }
  }

  const summary = allConvos.map((c) => ({
    id: c.id,
    title: c.title,
    create_time: c.create_time,
    update_time: c.update_time,
    model: c.current_model || c.default_model_slug,
    is_archived: c.is_archived,
  }));
  save("conversations_list.json", summary);
  console.log(`  📋 Found ${allConvos.length} total conversations\n`);

  // Now fetch full content for each conversation
  console.log("📝 Exporting full conversation contents (this may take a while)...");
  const convosDir = path.join(OUTPUT_DIR, "conversations");
  fs.mkdirSync(convosDir, { recursive: true });

  let exported = 0;
  let failed = 0;

  const MAX_RETRIES = 3;
  const failedConvos = [];
  let skipped = 0;

  for (const convo of allConvos) {
    const filename = `${sanitizeFilename(convo.title || convo.id)}_${convo.id.slice(0, 8)}.json`;
    const filepath = path.join(convosDir, filename);

    // Skip already-downloaded conversations
    if (fs.existsSync(filepath)) {
      skipped++;
      continue;
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const full = await apiGet(page, `/conversation/${convo.id}`);

        // Extract messages in readable order
        const messages = extractMessages(full);

        const out = {
          id: convo.id,
          title: full.title || convo.title,
          create_time: full.create_time,
          update_time: full.update_time,
          model: full.default_model_slug,
          messages,
          _raw_mapping: full.mapping, // keep raw data too
        };

        fs.writeFileSync(filepath, JSON.stringify(out, null, 2));

        exported++;

        if (exported % 25 === 0) {
          console.log(`  ... exported ${exported}/${allConvos.length - skipped} conversations`);
        }

        // Rate limit protection: 1s between requests
        await page.waitForTimeout(1000);
        break;
      } catch (err) {
        const isRateLimit = err.message.includes("429");
        const isTransient = err.message.includes("Failed to fetch") || err.message.includes("context was destroyed");

        if (attempt < MAX_RETRIES && (isRateLimit || isTransient)) {
          // Exponential backoff: 5s, 15s, 30s for rate limits; 2s, 4s, 6s for transient errors
          const delay = isRateLimit ? 5000 * (attempt + 1) : 2000 * (attempt + 1);
          console.log(`  ⏳ ${isRateLimit ? "Rate limited" : "Transient error"} on "${convo.title}" — waiting ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await page.waitForTimeout(delay);
          continue;
        }
        failed++;
        failedConvos.push({ title: convo.title, id: convo.id });
        console.log(`  ⚠️  Failed to export "${convo.title}" (${convo.id}): ${err.message}`);
      }
    }
  }

  console.log(`  ✅ Exported ${exported} conversations (${skipped} skipped, ${failed} failed)`);
  if (failedConvos.length > 0 && failedConvos.length <= 20) {
    console.log(`  Failed conversations:`);
    for (const c of failedConvos) {
      console.log(`     - "${c.title}" (${c.id})`);
    }
  }
}

function extractMessages(convoData) {
  if (!convoData.mapping) return [];

  const messages = [];
  const nodes = convoData.mapping;

  // Build a tree and walk it in order
  const roots = Object.keys(nodes).filter((id) => !nodes[id].parent);
  const visited = new Set();

  function walk(nodeId) {
    if (!nodeId || visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = nodes[nodeId];
    if (node?.message) {
      const msg = node.message;
      const role = msg.author?.role || "unknown";
      const contentParts = msg.content?.parts || [];

      const textParts = [];
      const attachments = [];

      for (const part of contentParts) {
        if (typeof part === "string") {
          textParts.push(part);
        } else if (part && typeof part === "object") {
          if (part.asset_pointer || part.content_type?.startsWith("image")) {
            attachments.push({
              type: "image",
              asset_pointer: part.asset_pointer,
              content_type: part.content_type,
              size_bytes: part.size_bytes,
              width: part.width,
              height: part.height,
              dalle: part.metadata?.dalle || null,
            });
          } else if (part.result !== undefined) {
            attachments.push({
              type: "code_output",
              result: part.result,
              language: part.language,
            });
          } else if (part.url || part.tether_id) {
            attachments.push({
              type: "citation",
              url: part.url,
              title: part.title,
              text: part.text,
              tether_id: part.tether_id,
            });
          } else if (Object.keys(part).length > 0) {
            attachments.push({ type: "unknown", raw: part });
          }
        }
      }

      const text = textParts.join("\n");
      const metadata = {
        model: msg.metadata?.model_slug,
        finish_reason: msg.metadata?.finish_details?.type,
        message_type: msg.metadata?.message_type,
        invoked_plugin: msg.metadata?.invoked_plugin,
        dalle_prompt: msg.metadata?.dalle?.prompt,
      };

      if (text.trim() || attachments.length > 0 || role === "tool") {
        messages.push({
          role,
          content: text,
          attachments: attachments.length > 0 ? attachments : undefined,
          created_at: msg.create_time,
          metadata,
        });
      }
    }

    // Follow children
    for (const childId of node?.children || []) {
      walk(childId);
    }
  }

  for (const root of roots) {
    walk(root);
  }

  return messages;
}

// ---------------------------------------------------------------------------
// 8. Export Archived Conversations
// ---------------------------------------------------------------------------
async function exportArchivedConversations(page) {
  console.log("📝 Exporting archived conversations...");
  let allArchived = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    try {
      const data = await apiGet(page, `/conversations?offset=${offset}&limit=${limit}&order=updated&is_archived=true`);
      const items = data.items || [];
      if (items.length === 0) break;
      allArchived = allArchived.concat(items);
      console.log(`  ... fetched ${allArchived.length} archived conversations so far`);
      if (items.length < limit) break;
      offset += limit;
      await page.waitForTimeout(500);
    } catch (err) {
      console.log(`  ⚠️  Error fetching archived conversations at offset ${offset}: ${err.message}`);
      break;
    }
  }

  save(
    "archived_conversations_list.json",
    allArchived.map((c) => ({
      id: c.id,
      title: c.title,
      create_time: c.create_time,
      update_time: c.update_time,
      model: c.current_model || c.default_model_slug,
      is_archived: true,
    })),
  );
  console.log(`  📋 Found ${allArchived.length} archived conversations\n`);
  return allArchived;
}

// ---------------------------------------------------------------------------
// 9. Export Conversation Projects (formerly "Folders")
//    ChatGPT renamed folders to "Projects" — try both endpoints.
// ---------------------------------------------------------------------------
async function exportConversationFolders(page) {
  console.log("📝 Exporting conversation projects/folders...");

  const endpoints = ["/projects", "/projects?limit=100", "/folders", "/conversation_folders"];

  for (const endpoint of endpoints) {
    try {
      const data = await apiGet(page, endpoint);
      const items = data.items || data.projects || (Array.isArray(data) ? data : []);
      if (items.length > 0 || (data && !Array.isArray(data) && typeof data === "object")) {
        console.log(`  ✅ Found projects/folders via ${endpoint}`);
        save("folders.json", items.length > 0 ? items : data);
        return data;
      }
    } catch {
      // Try next endpoint
    }
  }

  console.log("  ⚠️  No projects/folders found (you may not have any, or the API changed)");
  save("folders.json", []);
  return [];
}

// ---------------------------------------------------------------------------
// 6. Export GPTs (custom GPTs you've created or saved)
//    Tries multiple endpoints — OpenAI renames these frequently.
// ---------------------------------------------------------------------------
function extractGptsFromResponse(data) {
  const raw = data.cuts || data.list || data.items || data.gizmos || [];
  return raw
    .map((g) => {
      const info = g.resource?.gizmo || g.gizmo || g;
      return {
        id: info.id,
        name: info.display?.name || info.name,
        description: info.display?.description || info.description,
        instructions: info.instructions,
        created_at: info.created_at,
        updated_at: info.updated_at,
      };
    })
    .filter((g) => g.id);
}

async function exportGPTs(page) {
  console.log("📝 Exporting custom GPTs...");

  // Try multiple known endpoints in order — OpenAI moves these around
  const endpoints = [
    "/gizmos/discovery/mine",
    "/gizmos/bootstrap",
    "/gizmos/discovery?filter=mine",
    "/gizmos/mine",
    "/gizmos?limit=100",
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await apiGet(page, endpoint);
      const gpts = extractGptsFromResponse(data);
      if (gpts.length > 0) {
        console.log(`  ✅ Found ${gpts.length} GPTs via ${endpoint}`);
        save("custom_gpts.json", gpts);
        return gpts;
      }
      // Got a response but no GPTs — might be the wrong shape, try next
    } catch {
      // Endpoint doesn't exist or failed — try next
    }
  }

  // All API endpoints failed — try scraping the /gpts/mine page
  console.log("  ⚠️  API endpoints failed — trying UI scrape of /gpts/mine...");
  try {
    const gpts = await scrapeGPTsFromUI(page);
    if (gpts.length > 0) {
      console.log(`  ✅ Found ${gpts.length} GPTs via UI scrape`);
      save("custom_gpts.json", gpts);
      return gpts;
    }
  } catch (err) {
    console.log(`  ⚠️  UI scrape failed: ${err.message}`);
  }

  console.log("  ⚠️  No custom GPTs found (you may not have any, or the API changed)");
  save("custom_gpts.json", []);
  return [];
}

async function scrapeGPTsFromUI(page) {
  try {
    await page.goto(`${BASE}/gpts/mine`, { waitUntil: "domcontentloaded" });
  } catch (err) {
    if (!err.message.includes("interrupted") && !err.message.includes("ERR_ABORTED")) throw err;
  }
  await page.waitForTimeout(3000);

  // Scroll to load all GPTs
  await autoScroll(page, "main");

  const gpts = await page.evaluate(() => {
    const results = [];
    // GPT cards typically have links to /g/<id>
    const links = document.querySelectorAll('a[href*="/g/"]');
    const seen = new Set();
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/g\/(g-[A-Za-z0-9]+)/);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);

      const name =
        link.querySelector("h3, [class*='title'], strong")?.textContent?.trim() || link.textContent?.trim().slice(0, 100) || "";
      const desc = link.querySelector("p, [class*='desc']")?.textContent?.trim() || "";

      if (name) {
        results.push({ id: match[1], name, description: desc });
      }
    }
    return results;
  });

  // Navigate back to main chat
  await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(2000);

  return gpts;
}

// ---------------------------------------------------------------------------
// 7. Export Shared Links (paginated)
// ---------------------------------------------------------------------------
async function exportSharedLinks(page) {
  console.log("📝 Exporting shared conversation links...");
  let allShared = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    try {
      const data = await apiGet(page, `/shared_conversations?offset=${offset}&limit=${limit}&order=created`);
      const items = data.items || [];
      if (items.length === 0) break;
      allShared = allShared.concat(items);
      console.log(`  ... fetched ${allShared.length} shared links so far`);
      if (items.length < limit || allShared.length >= (data.total || Infinity)) break;
      offset += limit;
      await page.waitForTimeout(300);
    } catch (err) {
      if (allShared.length === 0) {
        console.log(`  ⚠️  Could not fetch shared links (${err.message})`);
      }
      break;
    }
  }

  save("shared_links.json", allShared);
}

// ===========================================================================
// UI Interaction Helpers (used by implicit profile extraction)
// ===========================================================================

async function ensureOnChat(page) {
  if (!page.url().startsWith(BASE)) {
    console.log("  ⏳ Session interrupted by auth — waiting for you to complete it...");
    await waitForChatReady(page, { timeoutMs: 180_000, navigate: false });
  }
}

async function sendMessage(page, text) {
  await ensureOnChat(page);

  // ChatGPT's composer is a contenteditable <div id="prompt-textarea">, NOT a
  // <textarea>. There IS a hidden fallback <textarea> in the DOM but it's never
  // visible. We must target the contenteditable div specifically.
  const composerSelector = "#prompt-textarea";

  let composer;
  try {
    composer = await page.waitForSelector(composerSelector, { timeout: 15_000, state: "visible" });
  } catch {
    await ensureOnChat(page);
    composer = await page.waitForSelector(composerSelector, { timeout: 15_000, state: "visible" });
  }

  // Click to focus the composer
  await composer.click();
  await page.waitForTimeout(200);

  // Fill the text. page.fill() handles contenteditable elements.
  // If that fails (React editor quirks), fall back to clipboard paste.
  try {
    await page.fill(composerSelector, text);
  } catch {
    // Fallback: select all, delete, then paste via keyboard
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press("Backspace");
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await page.keyboard.press(`${modifier}+v`);
    await page.waitForTimeout(500);
  }

  await page.waitForTimeout(300);

  // Click send button
  const sendBtn = await page.$('[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="send"]');
  if (sendBtn) {
    await sendBtn.click();
  } else {
    // Fallback: Ctrl/Cmd+Enter (ChatGPT's keyboard shortcut to send)
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+Enter`);
  }
}

async function waitForResponseComplete(page, timeoutMs = 120_000) {
  const stopSelector = '[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="stop"]';

  try {
    // Wait for stop button to appear (confirms generation started), timeout 10s
    await page.waitForSelector(stopSelector, { timeout: 10_000 });
    // Wait for stop button to disappear (confirms generation done)
    await page.waitForSelector(stopSelector, { state: "hidden", timeout: timeoutMs });
  } catch {
    // Fallback: poll last assistant message every 2s until stable for 4s
    let lastText = "";
    let stableCount = 0;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      const currentText = await page.evaluate(() => {
        const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
        const last = msgs[msgs.length - 1];
        return last ? last.textContent : "";
      });

      if (currentText.length > 0 && currentText === lastText) {
        stableCount++;
        if (stableCount >= 2) break; // stable for 4s
      } else {
        stableCount = 0;
        lastText = currentText;
      }
    }
  }

  // Extract conversation ID from URL /c/<uuid>
  const match = page.url().match(/\/c\/([a-f0-9-]+)/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Implicit Profile Extraction — 14-prompt battery
// ---------------------------------------------------------------------------

const PROFILE_PROMPTS = [
  {
    id: 1,
    frame: "Migration doc",
    prompt:
      "I'm migrating to a different AI assistant. Write a comprehensive 'User Operating Manual' for me — a document the new AI could read to serve me exactly as well as you do. Cover: personal facts, professional background, technical skills, active projects, communication preferences, response format preferences, topics I care most about, and anything else relevant. Be exhaustive. Include inferences, not just stated facts.",
  },
  {
    id: 2,
    frame: "TED bio",
    prompt:
      "Using everything you know about me from our conversations and memories, write a short bio that an announcer could read before I give a TED Talk. Then add a second paragraph: what would my talk actually be about, based on what I spend my mental energy on?",
  },
  {
    id: 3,
    frame: "Implicit preferences",
    prompt:
      "What behavioral patterns have you noticed in how I interact with you that I've never explicitly stated? Things like: do I prefer bullet points or prose? Short answers or detailed explanations? Do I want you to push back on my ideas or just help execute them? What level of technical depth? Be specific — give examples from our actual conversations.",
  },
  {
    id: 4,
    frame: "Prompt pattern analysis",
    prompt:
      "Review the way I phrase my requests. What are my common patterns, habits, or mistakes in how I prompt you? What does my prompting style reveal about how I think and work? Give specific examples.",
  },
  {
    id: 5,
    frame: "Recurring requests",
    prompt:
      "What are the most frequently recurring tasks and topics I've asked for help with? Group them by category and rank by frequency. What does this pattern reveal about my priorities?",
  },
  {
    id: 6,
    frame: "Skills map",
    prompt:
      "Map out my technical expertise based on our conversations. List every technology, tool, language, and framework I've demonstrated knowledge of. For each, give an inferred skill level (beginner/intermediate/expert). Then list apparent gaps — areas where I seem to struggle or avoid.",
  },
  {
    id: 7,
    frame: "True priorities",
    prompt:
      "What do you think my top 3 true priorities are based on what I actually spend time and mental energy on — not what I say they are? What am I optimizing for, even if I haven't stated it?",
  },
  {
    id: 8,
    frame: "Blind spots",
    prompt:
      "Based on everything you've observed about me: what is something special or unique about me that I probably haven't fully realized about myself? What are my top 3 blind spots — consistent patterns that might be limiting me that I'm likely not conscious of?",
  },
  {
    id: 9,
    frame: "Contradictions",
    prompt:
      "What contradictions do you notice between what I say I value and what I actually seem to prioritize based on our conversations? Where do my stated goals conflict with my observed behavior?",
  },
  {
    id: 10,
    frame: "Brutally honest advisor",
    prompt:
      "Act as my brutally honest advisor. No fluff, no positivity bias. What are the most important things I need to hear about myself based on everything you've observed? What am I missing? What risks am I not seeing?",
  },
  {
    id: 11,
    frame: "Novel character",
    prompt:
      "If I were the protagonist of a novel, what would be my core character arc? What's my fatal flaw? What's my greatest strength? What would the narrative tension in my story be?",
  },
  {
    id: 12,
    frame: "Hidden passions",
    prompt:
      "What passions or interests do I hint at in our conversations but haven't fully pursued? What does the shape of my curiosity suggest about what I actually want to be doing?",
  },
  {
    id: 13,
    frame: "JSON dump",
    prompt:
      "Create a structured JSON object containing everything you know and have inferred about me. Include these keys: `personal_facts`, `professional_background`, `technical_skills` (array with name+level), `communication_preferences`, `response_format_preferences`, `active_projects`, `interests`, `blind_spots`, `personality_traits`, `inferred_values`, `misc`. Be exhaustive.",
  },
  {
    id: 14,
    frame: "Synthesis close",
    prompt:
      "Final question: if you could send exactly 10 bullet points to the next AI assistant that will work with me — the 10 things that would most help them understand and serve me well — what would they be?",
  },
];

async function extractImplicitProfile(page) {
  console.log("🧠 Extracting implicit profile via probing prompts...");
  console.log("   This will send 14 prompts to ChatGPT in sequence.\n");

  // ensureLoggedIn() already confirmed we're on chatgpt.com with the composer.
  // DO NOT call page.goto(BASE) here — every navigation gives ChatGPT a chance
  // to demand re-auth (2FA, email verification) and tear the user away.
  //
  // If we're inside an existing conversation (/c/<uuid>), click the "New chat"
  // link in the sidebar instead of navigating.
  if (/\/c\/[a-f0-9-]+/.test(page.url())) {
    const newChatLink =
      (await page.$('a[data-testid="create-new-chat-button"]')) ||
      (await page.$('nav a[href="/"]')) ||
      (await page.$('a[href="/"]'));
    if (newChatLink) {
      await newChatLink.click();
      await page.waitForTimeout(2000);
    }
  }

  const results = [];
  let convId = null;
  const total = PROFILE_PROMPTS.length;

  for (let i = 0; i < total; i++) {
    const { id, frame, prompt } = PROFILE_PROMPTS[i];
    console.log(`  📤 [${id}/${total}] ${frame}...`);

    await sendMessage(page, prompt);
    convId = await waitForResponseComplete(page);

    // Use DOM extraction as primary — avoids re-fetching the growing conversation
    const response = await page.evaluate(() => {
      const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
      const last = msgs[msgs.length - 1];
      return last ? last.textContent : "";
    });

    console.log(`  ✅ [${id}/${total}] Got response (${response.length} chars)`);

    results.push({
      id,
      frame,
      prompt,
      response,
      conversation_id: convId,
      timestamp: new Date().toISOString(),
    });

    // Anti-rate-limit pause between prompts
    if (i < total - 1) {
      await page.waitForTimeout(1500);
    }
  }

  // Single API fetch at the end for structured data (higher fidelity markdown)
  if (convId) {
    try {
      const convoData = await apiGet(page, `/conversation/${convId}`);
      const messages = extractMessages(convoData);
      const assistantMsgs = messages.filter((m) => m.role === "assistant");
      for (let i = 0; i < results.length && i < assistantMsgs.length; i++) {
        if (assistantMsgs[i]?.content) {
          results[i].response = assistantMsgs[i].content;
        }
      }
      console.log("  ✅ Enriched responses with API data (markdown formatting)");
    } catch (err) {
      console.log(`  ⚠️  API enrichment failed (${err.message}), using DOM-captured text`);
    }
  }

  save("implicit_profile.json", results);
  console.log(`\n  ✅ Implicit profile saved (${results.length} Q&A pairs)`);
  return results;
}

// ===========================================================================
// MAIN
// ===========================================================================
async function main() {
  console.log("🚀 ChatGPT Full Exporter\n");

  const { context, page } = await launch();

  try {
    await ensureLoggedIn(page);

    // Pre-fetch the access token so API calls work
    if (!LOGIN_ONLY) {
      await getAccessToken(page);
    }

    if (LOGIN_ONLY) {
      console.log("✅ Login successful. Profile saved. Run again without --login to export.");
      console.log("   Press Ctrl+C to close.");
      await page.waitForTimeout(999_999_999);
      return;
    }

    if (FULL || MEMORIES_ONLY) {
      await exportMemories(page);
    }

    if (FULL) {
      await exportCustomInstructions(page);
      await exportUserInfo(page);
      await exportModelConfig(page);
      await exportGPTs(page);
      await exportSharedLinks(page);
      await exportConversationFolders(page);
    }

    if (FULL || CONVOS_ONLY) {
      await exportConversations(page);
    }

    if (FULL || ARCHIVED_ONLY) {
      await exportArchivedConversations(page);
    }

    // Implicit profile runs last in full mode (needs fresh chat UI)
    if (FULL || PROFILE_ONLY) {
      await extractImplicitProfile(page);
    }

    console.log("\n🎉 Export complete! Files saved to:");
    console.log(`   ${OUTPUT_DIR}\n`);

    // Print summary
    const files = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".json"));
    console.log("   Exported files:");
    for (const f of files) {
      const size = fs.statSync(path.join(OUTPUT_DIR, f)).size;
      console.log(`     📄 ${f} (${(size / 1024).toFixed(1)} KB)`);
    }
    const convoDir = path.join(OUTPUT_DIR, "conversations");
    if (fs.existsSync(convoDir)) {
      const convoFiles = fs.readdirSync(convoDir);
      console.log(`     📁 conversations/ (${convoFiles.length} files)`);
    }
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
