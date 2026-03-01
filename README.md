# ChatGPT → Claude Migrator

> Export **everything** from your ChatGPT account and migrate it to Claude — memories, instructions, GPTs, conversations, and a deep AI-generated profile of who you are.

---

## What it does

ChatGPT holds years of context about you: explicit memories, custom instructions, thousands of conversations — and implicit knowledge that was never written down. This tool captures all of it and converts it into formats Claude can use immediately.

| Data | Export file | Claude output |
|---|---|---|
| Memories | `memories.json` | `memory-import.txt` + `CLAUDE.md` |
| Custom Instructions | `custom_instructions.json` | `CLAUDE.md` section |
| User / Account Info | `user_info.json` | Referenced in `CLAUDE.md` |
| Model Config | `model_config.json` | Reference only |
| Custom GPTs | `custom_gpts.json` | `projects/<name>/CLAUDE.md` per GPT |
| Shared Links | `shared_links.json` | Reference only |
| Conversation Folders | `folders.json` | Reference only |
| Conversation List | `conversations_list.json` | Reference only |
| Full Conversations | `conversations/*.json` | Markdown by date + topic |
| Archived Conversations | `archived_conversations_list.json` | Reference only |
| **Implicit Profile** | `implicit_profile.json` | Quick Reference + full Q&A in `CLAUDE.md` |

---

## Quickstart

```bash
git clone <repo>
cd chatgpt-exporter
npm install
npm start
```

`npm start` launches the interactive wizard — it handles everything from Playwright setup to login to export and migration.

---

## Manual usage

### 1. Install

```bash
npm install
```

Playwright's Chromium browser is installed automatically on first run. You can also install it manually:

```bash
npx playwright install chromium
```

### 2. Log in (first time only)

```bash
node export.mjs --login
# or
npm run login
```

A Chromium window opens. Log in to ChatGPT. Your session is saved to `.chatgpt-profile/` — you won't need to log in again unless you clear it.

### 3. Export from ChatGPT

```bash
node export.mjs          # Export everything
npm run export

# Selective:
node export.mjs --memories     # Only memories
node export.mjs --convos       # Only conversations
node export.mjs --archived     # Only archived conversations
node export.mjs --profile      # Only implicit profile (14-prompt battery)
```

Output goes to `export/`.

### 4. Migrate to Claude

```bash
node migrate.mjs         # Full migration
npm run migrate

# Selective:
node migrate.mjs --memories         # memories → memory-import.txt
node migrate.mjs --instructions     # custom instructions → CLAUDE.md
node migrate.mjs --gpts             # GPTs → projects/
node migrate.mjs --convos           # conversations → markdown
node migrate.mjs --profile          # implicit profile → CLAUDE.md + memory-import.txt
node migrate.mjs --max-convos 100   # limit conversations processed
node migrate.mjs --dry-run          # preview without writing files
```

Output goes to `claude-import/`.

### Do it all at once

```bash
npm run full
# equivalent to: node export.mjs && node migrate.mjs
```

---

## Implicit Profile Extraction

The most powerful feature. ChatGPT holds implicit knowledge about you — inferred preferences, behavioral patterns, skill levels, blind spots — that was never explicitly written to your memories. The only way to surface it is to ask directly with carefully crafted prompts.

```bash
node export.mjs --profile
node migrate.mjs --profile
# or both at once:
npm run profile
```

This fires a **14-prompt battery** in a single ChatGPT conversation:

| # | Frame | What it surfaces |
|---|---|---|
| 1 | Migration doc | Exhaustive "User Operating Manual" — facts, skills, projects, style |
| 2 | TED bio | How ChatGPT would introduce you and what your talk would be about |
| 3 | Implicit preferences | Bullet/prose? Short/detailed? Push back or execute? Technical depth? |
| 4 | Prompt pattern analysis | How you think and work, revealed by how you write requests |
| 5 | Recurring requests | Your top topics by frequency — what you actually prioritize |
| 6 | Skills map | Every technology with inferred skill level + apparent gaps |
| 7 | True priorities | What you optimize for, even if you haven't said it |
| 8 | Blind spots | What's unique about you that you haven't realized; patterns limiting you |
| 9 | Contradictions | Where stated values conflict with observed behavior |
| 10 | Brutally honest advisor | Most important things to hear — no fluff |
| 11 | Novel character | Fatal flaw, greatest strength, narrative tension |
| 12 | Hidden passions | What your curiosity reveals about what you actually want |
| 13 | JSON dump | Structured object: skills, traits, values, projects, preferences |
| 14 | Synthesis close | 10 bullets — the things any AI working with you most needs to know |

**What you get:**

- `export/implicit_profile.json` — 14 Q&A pairs, raw
- `CLAUDE.md` — **Quick Reference** section at the top (10 bullets from prompt #14), full Q&A profile at the bottom
- `memory-import.txt` — facts from the JSON dump (prompt #13) appended as an "Inferred Profile" category

---

## Import into Claude

### Claude Code (global memory)

```bash
cp claude-import/CLAUDE.md ~/.claude/CLAUDE.md
```

Claude Code reads this file automatically at the start of every session.

### claude.ai / mobile app

1. Open `claude-import/memory-import.txt`
2. Go to **Settings → Memory**
3. Paste the content to seed Claude's memory

### Custom GPTs → Claude Projects

Each `claude-import/projects/<gpt-name>/CLAUDE.md` contains an adapted system prompt (ChatGPT/OpenAI references rewritten for Claude).

1. Create a new Project in claude.ai
2. Paste the file contents as **Custom Instructions**

### Conversation history

- Browse `claude-import/conversations/by-topic/` or `by-date/`
- Upload relevant markdown files to a Claude Project as reference context

---

## Output structure

```
export/                              # Raw ChatGPT data (JSON)
├── memories.json
├── custom_instructions.json
├── user_info.json
├── model_config.json
├── custom_gpts.json
├── shared_links.json
├── folders.json
├── conversations_list.json
├── archived_conversations_list.json
├── implicit_profile.json            # 14 Q&A pairs from profile extraction
└── conversations/
    └── <title>_<id>.json           # Full conversation data

claude-import/                       # Ready-to-use Claude files
├── CLAUDE.md                        # Master file — Quick Reference + memories + profile
├── memory-import.txt                # Paste into claude.ai / mobile memory settings
├── projects/
│   └── <gpt-name>/
│       └── CLAUDE.md               # Adapted GPT system prompt
├── conversations/
│   ├── by-date/
│   │   └── YYYY-MM/
│   │       └── <title>.md
│   └── by-topic/
│       └── <category>.md
└── metadata/
    └── migration-report.json        # Stats + audit trail
```

---

## Interactive wizard (`go.mjs`)

`npm start` launches a color-coded interactive menu:

```
┌─────────────────────────────────────────┐
│  ChatGPT → Claude Migration Wizard      │
└─────────────────────────────────────────┘

  [1]  Full migration
       Export everything + implicit profile + convert to Claude

  [2]  Quick migration
       Memories + custom instructions only (fastest)

  [3]  Export only
       Raw JSON dump to export/ — no Claude conversion

  [4]  Migrate only
       Already exported? Just convert to Claude format

  [5]  Implicit profile
       14-prompt AI probing battery only

  [6]  Re-login
       Clear saved session and log in again
```

- Auto-installs Playwright Chromium if missing
- Detects saved session — skips login if already authenticated
- Streams live command output
- Prints exact copy-paste next steps when done
- Works on Mac, Linux, and Windows Terminal / PowerShell 7

---

## Notes

- Runs **headful** (visible browser window) so you can monitor progress and handle CAPTCHAs if needed
- Rate limiting: small delays between API calls to stay well under ChatGPT's limits
- Large accounts (1000+ conversations) may take 10–30 minutes to export
- The migrate step works **offline** — reads from `export/`, no browser needed
- Re-running export won't overwrite existing conversation files
- The implicit profile extraction uses a single conversation thread so ChatGPT has context of previous answers as it goes deeper
- ChatGPT's internal API is undocumented and may change — open an issue if selectors break
