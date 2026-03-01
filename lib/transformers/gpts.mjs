import path from "path";
import { sanitizeFilename, saveFile } from "../utils.mjs";

function adaptSystemPrompt(text) {
  if (!text) return "";
  return text
    .replace(/You are (?:a )?(?:custom )?(?:version of )?ChatGPT/gi, "You are Claude")
    .replace(/\bChatGPT\b/gi, "Claude")
    .replace(/\bGPT-4o?\b/gi, "Claude")
    .replace(/\bOpenAI\b/gi, "Anthropic")
    .replace(/\bDALL[·-]?E\b/gi, "image generation")
    .replace(/\bCode Interpreter\b/gi, "code execution")
    .replace(/\bbrowsing\b/gi, "web search");
}

function generateClaudeMd(gpt) {
  const name = gpt.name || gpt.id || "Unnamed GPT";
  let md = `# ${name}\n\n`;

  if (gpt.description) {
    md += `> ${gpt.description}\n\n`;
  }

  if (gpt.instructions) {
    md += `## Instructions\n\n`;
    md += adaptSystemPrompt(gpt.instructions);
    md += "\n\n";
  }

  md += `---\n`;
  md += `*Migrated from ChatGPT Custom GPT — ${new Date().toISOString().split("T")[0]}*\n`;
  if (gpt.id) md += `*Original GPT ID: ${gpt.id}*\n`;

  return md;
}

export async function transformGPTs(gpts, opts) {
  if (!Array.isArray(gpts) || gpts.length === 0) {
    console.log("  ℹ️  No custom GPTs to transform.");
    return { total: 0, projects: [] };
  }

  const projectsDir = path.join(opts.outputDir, "projects");
  const results = [];

  for (const gpt of gpts) {
    const name = gpt.name || gpt.id || "unnamed";
    const safeName = sanitizeFilename(name);
    const projectDir = path.join(projectsDir, safeName);
    const claudeMd = generateClaudeMd(gpt);

    saveFile(path.join(projectDir, "CLAUDE.md"), claudeMd, opts.dryRun);

    results.push({
      name,
      id: gpt.id,
      dir: safeName,
      hasInstructions: !!gpt.instructions,
    });
  }

  console.log(`  🤖 GPTs: ${gpts.length} projects created in claude-import/projects/`);

  return { total: gpts.length, projects: results };
}
