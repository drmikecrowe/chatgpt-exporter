import fs from "fs";
import path from "path";
import { sanitizeFilename, saveFile, categorizeByKeywords } from "../utils.mjs";

function conversationToMarkdown(convo) {
  const title = convo.title || "Untitled Conversation";
  let md = `# ${title}\n\n`;

  if (convo.create_time) {
    const d = new Date(convo.create_time * 1000);
    md += `*Date: ${d.toISOString().split("T")[0]}*  \n`;
  }
  if (convo.model) md += `*Model: ${convo.model}*  \n`;
  md += "\n---\n\n";

  for (const msg of convo.messages || []) {
    const roleLabel = {
      user: "**You**",
      assistant: "**Claude** *(was ChatGPT)*",
      system: "**System**",
      tool: "**Tool**",
    }[msg.role] || `**${msg.role}**`;

    md += `### ${roleLabel}\n\n`;

    if (msg.content?.trim()) {
      md += msg.content.trim();
      md += "\n\n";
    } else {
      md += "*[no text content]*\n\n";
    }

    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        if (att.type === "image") {
          if (att.dalle?.prompt) {
            md += `> 🎨 **Image generated** — Prompt: "${att.dalle.prompt}"\n\n`;
          } else {
            md += `> 🖼️ **Image** (${att.content_type || "unknown type"})\n\n`;
          }
        } else if (att.type === "citation") {
          const label = att.title || att.url || "link";
          md += `> 🔗 **Citation:** [${label}](${att.url || ""})\n\n`;
        } else if (att.type === "code_output") {
          md += "**Code output:**\n```\n" + (att.result || "") + "\n```\n\n";
        }
      }
    }
  }

  return md;
}

export async function transformConversations(opts) {
  const convosDir = path.join(opts.exportDir, "conversations");
  if (!fs.existsSync(convosDir)) {
    console.log("  ℹ️  No conversations directory found — skipping.");
    return { total: 0 };
  }

  const files = fs.readdirSync(convosDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("  ℹ️  No conversation files found — skipping.");
    return { total: 0 };
  }

  const limit = opts.maxConvos > 0 ? Math.min(opts.maxConvos, files.length) : files.length;
  console.log(`  💬 Processing ${limit} of ${files.length} conversations...`);

  const byDateDir = path.join(opts.outputDir, "conversations", "by-date");
  const byTopicDir = path.join(opts.outputDir, "conversations", "by-topic");

  if (!opts.dryRun) {
    fs.mkdirSync(byDateDir, { recursive: true });
    fs.mkdirSync(byTopicDir, { recursive: true });
  }

  const topicBuckets = {};
  let processed = 0;
  let totalMessages = 0;

  for (let i = 0; i < limit; i++) {
    const file = files[i];
    let convo;
    try {
      convo = JSON.parse(fs.readFileSync(path.join(convosDir, file), "utf-8"));
    } catch {
      continue;
    }

    const markdown = conversationToMarkdown(convo);

    // Date bucket
    const ts = convo.create_time ? convo.create_time * 1000 : Date.now();
    const d = new Date(ts);
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    // Topic categorization: use title + first 3 user messages
    const textForCat = [
      convo.title || "",
      ...(convo.messages || [])
        .filter((m) => m.role === "user")
        .slice(0, 3)
        .map((m) => m.content || ""),
    ].join(" ");
    const topic = categorizeByKeywords(textForCat);

    if (!topicBuckets[topic]) topicBuckets[topic] = [];
    topicBuckets[topic].push({
      title: convo.title || "Untitled",
      date: d.toISOString().split("T")[0],
      messageCount: convo.messages?.length || 0,
      model: convo.model || "unknown",
      filename: file,
    });

    // Write markdown by date
    if (!opts.dryRun) {
      const dateDir = path.join(byDateDir, yearMonth);
      fs.mkdirSync(dateDir, { recursive: true });
      const mdName = sanitizeFilename(convo.title || convo.id || file) + ".md";
      fs.writeFileSync(path.join(dateDir, mdName), markdown);
    }

    totalMessages += convo.messages?.length || 0;
    processed++;

    if (processed % 100 === 0) {
      console.log(`     ... ${processed}/${limit}`);
    }
  }

  // Write topic index files
  for (const [topic, convos] of Object.entries(topicBuckets)) {
    const topicFilename = sanitizeFilename(topic) + ".md";
    let content = `# ${topic}\n\n`;
    content += `${convos.length} conversation${convos.length !== 1 ? "s" : ""}\n\n`;
    for (const c of convos) {
      content += `## ${c.title}\n`;
      content += `*${c.date} · ${c.messageCount} messages · ${c.model}*\n\n`;
    }
    saveFile(path.join(byTopicDir, topicFilename), content, opts.dryRun);
  }

  const topicSummary = Object.fromEntries(
    Object.entries(topicBuckets).map(([k, v]) => [k, v.length])
  );

  console.log(`  💬 Conversations: ${processed} processed, ${totalMessages} total messages`);
  console.log(`     Topics: ${Object.keys(topicSummary).join(", ")}`);

  return { total: processed, totalMessages, topics: topicSummary };
}
