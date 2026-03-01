# ChatGPT → Claude Migrator

> Export **everything** from your ChatGPT account and migrate it to Claude — memories, instructions, GPTs, conversations, and a deep AI-generated profile of who you are. Uploads it all to Claude Projects automatically.

---

## Quickstart

```bash
git clone https://github.com/gneitzke/chatgpt-exporter.git
cd chatgpt-exporter
npm install
npm start
```

`npm start` runs the full pipeline automatically:

1. Installs Playwright Chromium (if needed)
2. Opens a browser for ChatGPT login (first time only)
3. Exports everything — memories, instructions, GPTs, conversations, implicit profile
4. Converts to Claude format — `CLAUDE.md`, `memory-import.txt`, markdown conversations
5. Categorizes conversations into ~20 topic-based bundles
6. Uploads all bundles to claude.ai Projects

When it finishes, you get clear instructions on what to do next.

### To update later

Just run `npm start` again. It re-exports from ChatGPT, re-migrates, re-categorizes, and uploads any new bundles. Already-uploaded projects are skipped.

---

## What it exports

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

## After migration — set up Claude

### Claude Code (one-time)

```bash
cp claude-import/CLAUDE.md ~/.claude/CLAUDE.md
```

This gives Claude Code your preferences, skills, and working style in every session.

### claude.ai memories (one-time)

1. Open `claude-import/memory-import.txt`
2. Go to **Settings → Memory** on claude.ai
3. Paste the content to seed Claude's memory

### Claude Projects (automatic)

The upload step creates ~20 topic-based projects on claude.ai (AI & LLMs, Programming, Animals, etc.) with your conversation history as project knowledge. These are browsable in Claude chat.

### Custom GPTs → Claude Projects

Each `claude-import/projects/<gpt-name>/CLAUDE.md` contains an adapted system prompt. Create a new Project in claude.ai and paste as Custom Instructions.

---

## Scripts

| Command | What it does |
|---------|-------------|
| `npm start` | **Full automatic migration** — export, convert, categorize, upload |
| `npm run menu` | Interactive menu — pick individual steps |
| `npm run export` | Just export from ChatGPT |
| `npm run migrate` | Just convert exports to Claude format |
| `npm run categorize` | Just categorize conversations into bundles |
| `npm run upload` | Just upload pending bundles to Claude Projects |
| `npm run search` | Search your exported conversation history |
| `npm run login` | Just open browser for ChatGPT login |
| `npm run profile` | Just run implicit profile extraction |
| `npm run full` | Export + migrate (no upload) |

---

## Implicit Profile Extraction

The most powerful feature. ChatGPT holds implicit knowledge about you — inferred preferences, behavioral patterns, skill levels, blind spots — that was never explicitly written to your memories. The only way to surface it is to ask directly with carefully crafted prompts.

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

---

## Output structure

```
export/                              # Raw ChatGPT data (JSON)
├── memories.json
├── custom_instructions.json
├── user_info.json
├── custom_gpts.json
├── implicit_profile.json
└── conversations/
    └── <title>_<id>.json

claude-import/                       # Claude-ready files
├── CLAUDE.md                        # Master profile — copy to ~/.claude/CLAUDE.md
├── memory-import.txt                # Paste into claude.ai memory settings
├── projects/
│   └── <gpt-name>/CLAUDE.md        # Adapted GPT system prompts
└── conversations/
    ├── by-date/YYYY-MM/*.md
    └── by-topic/<category>.md

claude-projects/                     # Upload bundles for claude.ai Projects
├── _manifest.json                   # Upload status tracking (resumable)
├── 01-3D-Printing-CAD/
│   ├── _project.json
│   ├── _README.md
│   └── *.md                        # Conversation files
├── 02-AI-LLMs-Part-1/
└── ...
```

---

## Topic categories

Conversations are automatically categorized into 15 topics (plus General):

AI & LLMs, GPU & Compute, Programming & Code, Networking & Infra, Hardware & Electronics, 3D Printing & CAD, Solar & Energy, Animals & Livestock, Gardening & Outdoors, Food & Cooking, Home & Property, Health & Fitness, Work & Leadership, Image Generation, Writing & Content

Categories exceeding 180k tokens are split into parts (e.g., "AI & LLMs Part 1", "AI & LLMs Part 2") to stay within Claude's project knowledge limit.

---

## Notes

- Uses Playwright's **bundled Chromium** — no need to have Chrome installed
- Runs **headful** (visible browser window) so you can monitor progress and handle CAPTCHAs
- Rate limiting: small delays between API calls to stay under ChatGPT's limits
- Large accounts (1000+ conversations) may take 10–30 minutes to export
- The migrate step works **offline** — reads from `export/`, no browser needed
- Re-running export won't overwrite existing conversation files
- Claude Project uploads are **resumable** — if it fails partway, re-run to continue
- Separate browser profiles for ChatGPT (`.chatgpt-profile/`) and Claude (`.claude-profile/`)
