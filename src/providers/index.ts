import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { Provider } from "./provider";

const anthropic = new AnthropicProvider();
const openai = new OpenAIProvider();

/** Resolve the provider for a public model alias. */
export function getProviderForModel(model: string): Provider {
  if (model.startsWith("gpt")) return openai;
  // Default (and "claude-*") => Anthropic, the primary real integration.
  return anthropic;
}

/** Whether the provider backing a model alias is configured. */
export function isModelReady(model: string): boolean {
  return getProviderForModel(model).isReady();
}

/** True if at least one provider is configured. Used by /healthz. */
export function anyProviderReady(): boolean {
  return anthropic.isReady() || openai.isReady();
}

export { anthropic, openai };
