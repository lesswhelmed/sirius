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
import {
  deleteAsync,
  getInfoAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

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

// Completion marker, written only after every file of a model finished
// downloading. The library's isModelDownloaded is existence-only and its
// downloadModel short-circuits when the file exists, so an interrupted
// download would otherwise wedge the model as "ready" forever (a 960MB
// fragment of the 2.1GB Qwen GGUF did exactly that) — the marker is what
// distinguishes a finished download from an abandoned one.
function markerUri(spec: LocalModelSpec): string {
  return `file://${getModelPath(spec.hfPath)}.complete`;
}

async function isDownloadComplete(spec: LocalModelSpec): Promise<boolean> {
  const info = await getInfoAsync(markerUri(spec));
  return info.exists;
}

export async function isModelReady(id: string): Promise<boolean> {
  const spec = specOrThrow(id);
  const main = await isModelDownloaded(spec.hfPath);
  if (!main) {
    return false;
  }
  if (spec.projectorHfPath && !(await isModelDownloaded(spec.projectorHfPath))) {
    return false;
  }
  return isDownloadComplete(spec);
}

// Downloads the model weights (and the mmproj projector for vision models).
// Progress is the main file's percentage — the projector is comparatively tiny.
// Files without a completion marker are deleted first: they're leftovers of an
// interrupted download, and the library would otherwise skip re-downloading
// the partial file.
export async function downloadModelById(
  id: string,
  onProgress?: (percentage: number) => void
): Promise<void> {
  const spec = specOrThrow(id);
  if (await isModelReady(id)) {
    onProgress?.(100);
    return;
  }
  for (const hfPath of [spec.hfPath, spec.projectorHfPath]) {
    if (hfPath && (await isModelDownloaded(hfPath))) {
      await deleteAsync(`file://${getModelPath(hfPath)}`, {
        idempotent: true,
      });
    }
  }
  await downloadModel(spec.hfPath, (p) => onProgress?.(p.percentage));
  if (spec.projectorHfPath) {
    await downloadModel(spec.projectorHfPath);
  }
  await writeAsStringAsync(markerUri(spec), new Date().toISOString());
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
