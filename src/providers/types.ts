export type ProviderKind = "auto" | "openai-compatible" | "anthropic";

export type ModelSlotName = "fast" | "balanced" | "strong" | "vision";

export type ModelSlot = {
  slot: ModelSlotName;
  provider: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  pricingModelId?: string;
  supportsTools: boolean;
  supportsVision: boolean;
  contextWindowTokens?: number;
  providerInstanceId?: string;
};

export type ModelSlots = Partial<Record<ModelSlotName, ModelSlot>>;
