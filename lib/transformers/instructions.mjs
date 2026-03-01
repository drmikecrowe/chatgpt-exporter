// Tries multiple possible key paths to extract a field value from an object
function extractField(obj, paths) {
  for (const keyPath of paths) {
    const parts = keyPath.split(".");
    let cur = obj;
    for (const part of parts) {
      if (cur == null) break;
      cur = Array.isArray(cur) ? cur[parseInt(part, 10)] : cur[part];
    }
    if (cur && typeof cur === "string" && cur.trim()) return cur.trim();
  }
  return null;
}

function adaptToClaudeLanguage(text) {
  return text
    .replace(/\bChatGPT\b/gi, "Claude")
    .replace(/\bGPT-4o?\b/gi, "Claude")
    .replace(/\bOpenAI\b/gi, "Anthropic")
    .replace(/\bDALL[·-]?E\b/gi, "image generation")
    .replace(/\bCode Interpreter\b/gi, "code execution")
    .replace(/\bplugins?\b/gi, "tools");
}

export async function transformInstructions(instructions, userInfo, opts) {
  const aboutUserPaths = [
    "about_user_message",
    "personalization.about_user_message",
    "items.0.about_user_message",
    "data.about_user_message",
    "user_system_message",
  ];

  const aboutModelPaths = [
    "about_model_message",
    "personalization.about_model_message",
    "items.0.about_model_message",
    "data.about_model_message",
    "model_system_message",
  ];

  const aboutUser = instructions ? extractField(instructions, aboutUserPaths) : null;
  const aboutModel = instructions ? extractField(instructions, aboutModelPaths) : null;

  const userName =
    userInfo?.me?.name ||
    userInfo?.me?.email?.split("@")[0] ||
    null;

  let claudeSection = "## Custom Instructions (imported from ChatGPT)\n\n";

  if (userName) {
    claudeSection += `**User:** ${userName}\n\n`;
  }

  if (aboutUser) {
    claudeSection += "### About the User\n\n";
    claudeSection += adaptToClaudeLanguage(aboutUser) + "\n\n";
  }

  if (aboutModel) {
    claudeSection += "### Response Preferences\n\n";
    claudeSection += adaptToClaudeLanguage(aboutModel) + "\n\n";
  }

  if (!aboutUser && !aboutModel) {
    console.log("  ℹ️  No custom instructions found (fields may be empty).");
    return { claudeSection: "", files: [] };
  }

  console.log(`  📝 Custom instructions: ${aboutUser ? "about-user ✓" : "about-user ✗"}  ${aboutModel ? "response-prefs ✓" : "response-prefs ✗"}`);

  return {
    userName,
    aboutUserLen: aboutUser?.length || 0,
    aboutModelLen: aboutModel?.length || 0,
    claudeSection,
    files: [],
  };
}
