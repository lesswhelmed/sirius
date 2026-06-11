// Declarative registry of on-device GGUF models. `hfPath` is the
// "owner/repo/filename.gguf" id @react-native-ai/llama's storage helpers
// (downloadModel / isModelDownloaded / getModelPath) understand; files land in
// the app's document directory under llama-models/. Q4_K_M quants are the
// sweet spot for mobile (per react-native-ai's docs).
export type LocalModelSpec = {
  id: string;
  label: string;
  hfPath: string;
  // Approximate download size, for the UI only.
  sizeBytes: number;
  capability: "text" | "vision";
  // Multimodal projector (mmproj) for vision models; downloaded alongside the
  // main weights and passed to languageModel({ projectorPath }).
  projectorHfPath?: string;
};

export const LOCAL_MODELS: LocalModelSpec[] = [
  {
    id: "qwen2.5-3b-instruct",
    label: "Qwen 2.5 3B Instruct",
    hfPath: "Qwen/Qwen2.5-3B-Instruct-GGUF/qwen2.5-3b-instruct-q4_k_m.gguf",
    sizeBytes: 2_100_000_000,
    capability: "text",
  },
  {
    id: "qwen2.5-1.5b-instruct",
    label: "Qwen 2.5 1.5B Instruct (small)",
    hfPath: "Qwen/Qwen2.5-1.5B-Instruct-GGUF/qwen2.5-1.5b-instruct-q4_k_m.gguf",
    sizeBytes: 1_120_000_000,
    capability: "text",
  },
  // Experimental: photo (SIGHT) drafting. Small VLMs are shape-reliable under
  // structured output but content quality needs on-device evaluation before
  // this is surfaced beyond the model screen — see draftSightPost's caller.
  {
    id: "smolvlm2-2.2b-instruct",
    label: "SmolVLM2 2.2B (vision, experimental)",
    hfPath:
      "ggml-org/SmolVLM2-2.2B-Instruct-GGUF/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf",
    sizeBytes: 1_600_000_000,
    capability: "vision",
    projectorHfPath:
      "ggml-org/SmolVLM2-2.2B-Instruct-GGUF/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf",
  },
];

export const VISION_MODEL_ID = "smolvlm2-2.2b-instruct";

// The model used for chat and on-device curation unless the user downloads a
// different one first.
export const DEFAULT_TEXT_MODEL_ID = "qwen2.5-3b-instruct";

export function modelSpec(id: string): LocalModelSpec | undefined {
  return LOCAL_MODELS.find((m) => m.id === id);
}

export function textModels(): LocalModelSpec[] {
  return LOCAL_MODELS.filter((m) => m.capability === "text");
}

export function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
