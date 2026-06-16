/**
 * Rule-based prompt-injection detection.
 *
 * Pure functions only: given a string (or a list of messages), return the
 * rules that fired. No I/O. Designed to be conservative-but-useful — each rule
 * targets a known injection class from the threat list.
 */

export interface InjectionRule {
  /** Stable identifier written to the audit log. */
  name: string;
  /** Human-readable description of the threat class. */
  description: string;
  /** Detection pattern. */
  pattern: RegExp;
}

export interface InjectionFinding {
  rule: string;
  description: string;
  /** The substring that matched (truncated for safety). */
  match: string;
}

export interface MessageFinding extends InjectionFinding {
  /** Index of the message the finding came from. */
  messageIndex: number;
}

/**
 * Marker strings associated with injection / jailbreak attempts. Shared with
 * output validation so we can also block responses that echo them back.
 */
export const INJECTION_MARKERS: string[] = [
  "<|im_start|>",
  "<|im_end|>",
  "<|endoftext|>",
  "<|eot_id|>",
  "<<sys>>",
  "[/inst]",
  "[inst]",
  "###system",
  "do anything now",
  "developer mode",
  "jailbreak",
];

/**
 * Canary / bypass-indicator strings. If a model response echoes one of these,
 * it usually signals a successful injection ("prove you obeyed by replying
 * CONFIRMED"). Output validation blocks responses that contain them.
 */
export const BYPASS_INDICATORS: string[] = [
  "CONFIRMED",
  "DEBUG_OK",
  "COMPROMISED:",
  "TEST_ECHO_9X7",
  "[DAN]",
];

/**
 * Each rule is intentionally anchored to phrasing that is rare in legitimate
 * traffic. `i` flag for case-insensitivity; patterns avoid catastrophic
 * backtracking (no nested quantifiers over the same class).
 */
export const INJECTION_RULES: InjectionRule[] = [
  {
    name: "instruction_override",
    description: "Direct attempt to override or discard prior instructions",
    pattern:
      /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(all\s+)?(previous|prior|above|earlier|preceding|the\s+system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules?|directives?|context)\b/i,
  },
  {
    name: "forged_role_token",
    description: "Forged system/admin/assistant role token injection",
    pattern:
      /(<\|?\s*(system|assistant|developer)\s*\|?>|<\|im_(start|end)\|>\s*(system|assistant|developer|user)|<<\s*sys\s*>>|\[\/?inst\]|^\s*(system|assistant|developer|admin)\s*:|#{2,}\s*system)/im,
  },
  {
    name: "prompt_extraction",
    description: "Attempt to extract the system prompt / hidden instructions",
    pattern:
      /\b(reveal|repeat|print|show|expose|output|disclose|tell\s+me)\b[^.\n]{0,40}\b(your\s+)?(system\s+)?(prompt|instructions?|guidelines?|rules?|configuration|context|initial\s+message)\b/i,
  },
  {
    name: "secret_exfiltration",
    description: "Probe for secrets / credentials / environment variables",
    pattern:
      /\b(api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|password|credentials?|env(ironment)?\s+variables?|\.env\b|aws[\s_-]?(secret|access))\b/i,
  },
  {
    name: "persona_hijack_dan",
    description: "DAN / persona-hijack / jailbreak attempt",
    pattern:
      /\b(do\s+anything\s+now|\bDAN\b|developer\s+mode|jailbreak|you\s+are\s+now\s+|act\s+as\s+(an?\s+)?(unrestricted|uncensored|evil)|pretend\s+you\s+have\s+no\s+(rules|restrictions|guidelines))/i,
  },
  {
    name: "interpreter_roleplay",
    description: "Attempt to make the model roleplay as an interpreter/terminal",
    pattern:
      /\b(you\s+are|act\s+as|simulate|pretend\s+to\s+be|behave\s+like)\b[^.\n]{0,30}\b(a\s+)?(linux|unix|bash|python|sql|javascript|node)?\s*(terminal|shell|console|interpreter|repl|command\s+prompt)\b/i,
  },
  {
    name: "output_format_hijack",
    description: "Attempt to hijack output format / force verbatim output",
    pattern:
      /\b(respond|reply|answer|output|begin\s+your\s+(reply|response|answer))\b[^.\n]{0,30}\b(only\s+(with|in)|verbatim|exactly\s+as|with\s+the\s+following\s+text|nothing\s+else\s+but)\b/i,
  },
  {
    name: "end_marker_injection",
    description: "Injection of conversation end / control markers",
    pattern: /<\|(endoftext|eot_id|im_start|im_end)\|>|<\/?s>|\[\/?INST\]/i,
  },
  {
    name: "html_comment_smuggling",
    description: "Hidden instructions smuggled inside an HTML comment",
    pattern: /<!--[\s\S]*?-->/,
  },
  {
    name: "multilingual_bypass",
    description: "Instruction-override phrasing in a non-English language",
    pattern:
      // es: "ignora ... instrucciones", fr: "ignorez ... instructions",
      // de: "ignoriere ... anweisungen", he: "התעלם ... הוראות",
      // ru: "игнорируй ... инструкции"
      /(ignora[r]?\s+[^.\n]{0,30}instrucc|ignorez\s+[^.\n]{0,30}instruction|ignoriere\s+[^.\n]{0,30}anweisung|התעלם[^.\n]{0,30}הוראות|игнорир[а-я]*\s+[^.\n]{0,30}инструкц)/i,
  },
];

const MATCH_PREVIEW_LIMIT = 120;

function previewMatch(value: string | undefined): string {
  if (!value) return "";
  return value.length > MATCH_PREVIEW_LIMIT
    ? `${value.slice(0, MATCH_PREVIEW_LIMIT)}…`
    : value;
}

/** Run every rule against a single string and return all findings. */
export function detectInjection(text: string): InjectionFinding[] {
  if (!text) return [];
  const findings: InjectionFinding[] = [];
  for (const rule of INJECTION_RULES) {
    const m = rule.pattern.exec(text);
    if (m) {
      findings.push({
        rule: rule.name,
        description: rule.description,
        match: previewMatch(m[0]),
      });
    }
  }
  return findings;
}

export interface InspectableMessage {
  role: string;
  content: string;
}

/** Run detection across a list of messages, tagging each finding with its index. */
export function detectInjectionInMessages(
  messages: InspectableMessage[],
): MessageFinding[] {
  const findings: MessageFinding[] = [];
  messages.forEach((msg, messageIndex) => {
    for (const f of detectInjection(msg.content)) {
      findings.push({ ...f, messageIndex });
    }
  });
  return findings;
}

export interface InjectionInspection {
  isDetected: boolean;
  /** Distinct rule names that fired. */
  rules: string[];
  findings: InjectionFinding[];
}

/** Convenience wrapper returning a boolean verdict + the distinct fired rules. */
export function inspectInjection(text: string): InjectionInspection {
  const findings = detectInjection(text);
  return {
    isDetected: findings.length > 0,
    rules: [...new Set(findings.map((f) => f.rule))],
    findings,
  };
}
