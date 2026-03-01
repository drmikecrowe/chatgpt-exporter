// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract JSON object from a response that may wrap it in ```json ... ``` fences.
 */
function parseJsonFromResponse(text) {
  // Try fenced block first
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : text.trim();

  // Find the first { ... } block
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return null;

  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Extract bullet lines from a response (lines starting with -, *, •, or numbered).
 */
function extractBullets(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*•]|^\d+[.)]\s/.test(l))
    .map((l) => l.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, "").trim())
    .filter(Boolean);
}

/**
 * Flatten a JSON profile object into bullet strings for memory-import.txt.
 */
function flattenProfileToLines(obj, maxItems = 5) {
  const lines = [];

  for (const [key, value] of Object.entries(obj)) {
    if (!value || (Array.isArray(value) && value.length === 0)) continue;

    const label = key.replace(/_/g, " ");

    if (typeof value === "string") {
      lines.push(`${label}: ${value}`);
    } else if (Array.isArray(value)) {
      // technical_skills is array of {name, level}; others are string arrays
      const items = value.slice(0, maxItems).map((item) => {
        if (typeof item === "object" && item !== null) {
          return item.name ? `${item.name} (${item.level || "unknown"})` : JSON.stringify(item);
        }
        return String(item);
      });
      lines.push(`${label}: ${items.join(", ")}${value.length > maxItems ? ` +${value.length - maxItems} more` : ""}`);
    } else if (typeof value === "object") {
      const nested = Object.entries(value)
        .slice(0, maxItems)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ");
      if (nested) lines.push(`${label}: ${nested}`);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Main transformer
// ---------------------------------------------------------------------------

export async function transformImplicitProfile(profileData, opts) {
  if (!Array.isArray(profileData) || profileData.length === 0) {
    console.log("  ℹ️  No implicit profile data to transform.");
    return { quickRefBlock: "", quickReference: [], profileLines: [], claudeSection: "" };
  }

  // Find prompt #14 (synthesis close) and prompt #13 (JSON dump)
  const synthEntry = profileData.find((e) => e.id === 14);
  const jsonEntry = profileData.find((e) => e.id === 13);

  // --- Quick Reference: 10 bullets from prompt #14 ---
  const quickReference = synthEntry ? extractBullets(synthEntry.response) : [];

  // --- JSON profile facts from prompt #13 ---
  let profileLines = [];
  if (jsonEntry) {
    const parsed = parseJsonFromResponse(jsonEntry.response);
    if (parsed) {
      profileLines = flattenProfileToLines(parsed);
    }
  }

  // --- Build CLAUDE.md section ---
  let claudeSection = "";

  // Quick Reference block (will be inserted at top of master CLAUDE.md)
  let quickRefBlock = "";
  if (quickReference.length > 0) {
    quickRefBlock += "## Quick Reference\n\n";
    quickRefBlock += "*10 things any AI working with me should know:*\n\n";
    for (const bullet of quickReference) {
      quickRefBlock += `- ${bullet}\n`;
    }
    quickRefBlock += "\n";
  }

  // Full Q&A profile section
  claudeSection += "## Implicit Profile\n\n";
  claudeSection +=
    "*Extracted via structured probing prompts — inferred from conversation history.*\n\n";

  for (const entry of profileData) {
    claudeSection += `### ${entry.id}. ${entry.frame}\n\n`;
    claudeSection += `**Q:** ${entry.prompt}\n\n`;
    claudeSection += `**A:** ${entry.response.trim()}\n\n`;
    claudeSection += "---\n\n";
  }

  console.log(`  📝 Implicit profile: ${profileData.length} Q&A pairs processed`);
  if (quickReference.length > 0) {
    console.log(`     Quick Reference: ${quickReference.length} bullets from synthesis prompt`);
  }
  if (profileLines.length > 0) {
    console.log(`     JSON profile: ${profileLines.length} facts extracted`);
  }

  return {
    quickRefBlock,
    quickReference,
    profileLines,
    claudeSection,
  };
}

/**
 * Append implicit profile bullets to an existing memory-import.txt content string.
 */
export function appendProfileToMemoryImport(memoryImportContent, profileLines) {
  if (!profileLines || profileLines.length === 0) return memoryImportContent;

  let appended = memoryImportContent;
  if (!appended.endsWith("\n\n")) appended += "\n";

  appended += "## Inferred Profile\n";
  for (const line of profileLines) {
    appended += `- ${line}\n`;
  }
  appended += "\n";

  return appended;
}
