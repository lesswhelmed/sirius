// Singleton holder for the on-device llama.rn model. A prepared 3B model owns
// roughly 2 GB of RAM, so exactly one model is kept loaded at a time —
// requesting a different model releases the current one first. All callers
// (chat screen, curation) go through getPreparedModel so they share the same
// loaded context instead of racing to init their own.
import {
  downloadModel,
  getModelPath,
  isModelDownloaded,
  llama,
  type LlamaLanguageModel,
} from "@react-native-ai/llama";

import { modelSpec, type LocalModelSpec } from "./models";

export type DownloadState =
  | { status: "not-downloaded" }
  | { status: "downloading"; percentage: number }
  | { status: "downloaded" };

function specOrThrow(id: string): LocalModelSpec {
  const spec = modelSpec(id);
  if (!spec) {
    throw new Error(`unknown local model: ${id}`);
  }
  return spec;
}

export async function isModelReady(id: string): Promise<boolean> {
  const spec = specOrThrow(id);
  const main = await isModelDownloaded(spec.hfPath);
  if (!main) {
    return false;
  }
  if (spec.projectorHfPath) {
    return isModelDownloaded(spec.projectorHfPath);
  }
  return true;
}

// Downloads the model weights (and the mmproj projector for vision models).
// Progress is the main file's percentage — the projector is comparatively tiny.
export async function downloadModelById(
  id: string,
  onProgress?: (percentage: number) => void
): Promise<void> {
  const spec = specOrThrow(id);
  await downloadModel(spec.hfPath, (p) => onProgress?.(p.percentage));
  if (spec.projectorHfPath) {
    await downloadModel(spec.projectorHfPath);
  }
}

let prepared: { id: string; model: LlamaLanguageModel } | null = null;
let preparing: Promise<LlamaLanguageModel> | null = null;

// Returns a prepared (memory-loaded) model, loading it on first use. Serialized:
// concurrent callers wait for an in-flight prepare instead of double-initializing.
export async function getPreparedModel(
  id: string
): Promise<LlamaLanguageModel> {
  if (preparing) {
    await preparing.catch(() => {});
  }
  if (prepared?.id === id) {
    return prepared.model;
  }
  const spec = specOrThrow(id);
  preparing = (async () => {
    await releaseModel();
    const model = llama.languageModel(getModelPath(spec.hfPath), {
      ...(spec.projectorHfPath
        ? { projectorPath: getModelPath(spec.projectorHfPath) }
        : {}),
      contextParams: { n_ctx: 4096 },
    });
    await model.prepare();
    prepared = { id, model };
    return model;
  })();
  try {
    return await preparing;
  } finally {
    preparing = null;
  }
}

export async function releaseModel(): Promise<void> {
  if (!prepared) {
    return;
  }
  const current = prepared;
  prepared = null;
  try {
    await current.model.unload();
  } catch {
    // Releasing memory is best-effort; a failed unload must not break callers.
  }
}
