// Singleton holder for the on-device llama.rn model. A prepared 3B model owns
// roughly 2 GB of RAM, so exactly one model is kept loaded at a time —
// requesting a different model releases the current one first. All callers
// (chat screen, curation) go through getPreparedModel so they share the same
// loaded context instead of racing to init their own.
import { streamText } from "ai";
import {
  downloadModel,
  getModelPath,
  isModelDownloaded,
  type LlamaEmbeddingModel,
  type LlamaLanguageModel,
  llama,
} from "@react-native-ai/llama";
import {
  deleteAsync,
  getInfoAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";
// installJsi is the native-bridge installer underneath @react-native-ai/llama:
// it attaches llama.rn's ~40 JSI bindings (global.llamaInitContext, …) into the
// runtime. The bindings live in the compiled binary, NOT the JS bundle — so a
// stale .app (Metro reloaded but native never rebuilt after a llama.rn bump)
// makes RNLlama.install() return false and this throw "JSI bindings not
// installed" only AFTER a multi-GB model download + prepare(). We call it up
// front (it's cheap: no model load) to fail legibly and early instead.
import { installJsi } from "llama.rn";

import { type LocalModelSpec, modelSpec } from "./models";

export type DownloadState =
  | { status: "not-downloaded" }
  | { status: "downloading"; percentage: number }
  | { status: "downloaded" };

// Human-facing message for a binary whose native llama.rn bridge is missing —
// the one failure a download or reload can never fix. Matched against the raw
// llama.rn errors ("JSI bindings not installed" / "Missing JSI bindings: …").
export const MISSING_NATIVE_BRIDGE_MESSAGE =
  "This build is missing the on-device AI engine. Reinstall or update the app — reloading won't fix it. (Dev: rebuild the native app, e.g. `expo run:ios`; a Metro reload keeps the old binary.)";

function isMissingBridgeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("JSI bindings") || msg.includes("Missing JSI bindings");
}

export type NativeBridgeStatus = { ok: true } | { ok: false; reason: string };

let bridgeProbe: Promise<NativeBridgeStatus> | null = null;

// Probes whether the native llama.rn JSI bridge is installed in THIS binary,
// without loading any model. installJsi() is idempotent and only touches the
// native module, so this is cheap and safe to call before offering a download.
// Cached after the first success; a failure is not cached so a later rebuilt
// binary (dev) re-probes cleanly.
export async function checkNativeBridge(): Promise<NativeBridgeStatus> {
  if (bridgeProbe) {
    const prior = await bridgeProbe;
    if (prior.ok) {
      return prior;
    }
  }
  bridgeProbe = (async () => {
    try {
      await installJsi();
      return { ok: true } as const;
    } catch (err) {
      if (isMissingBridgeError(err)) {
        return { ok: false, reason: MISSING_NATIVE_BRIDGE_MESSAGE } as const;
      }
      // An unexpected install failure — surface its own message rather than
      // mislabeling it as a stale-binary problem.
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      } as const;
    }
  })();
  return bridgeProbe;
}

// Translates a raw inference error into the legible stale-binary message when
// it is one, otherwise returns the original message untouched. Used by the chat
// screen so the cryptic "JSI bindings not installed" never reaches the user.
export function describeLlmError(err: unknown): string {
  if (isMissingBridgeError(err)) {
    return MISSING_NATIVE_BRIDGE_MESSAGE;
  }
  return err instanceof Error ? err.message : "generation failed";
}

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
  if (
    spec.projectorHfPath &&
    !(await isModelDownloaded(spec.projectorHfPath))
  ) {
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
  onProgress?: (percentage: number) => void,
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

// One resident llama context at a time, whatever its kind. A chat 3B owns ~2GB,
// so we never keep two loaded — an embedding pass swaps the chat model out and the
// next chat turn swaps it back. The kind is derived from the spec's capability so
// an "embedding" model loads via textEmbeddingModel and a text/vision model via
// languageModel.
type PreparedModel = LlamaLanguageModel | LlamaEmbeddingModel;

let prepared: { id: string; model: PreparedModel } | null = null;
let preparing: Promise<PreparedModel> | null = null;

// Returns a prepared (memory-loaded) model, loading it on first use. Serialized:
// concurrent callers wait for an in-flight prepare instead of double-initializing.
// Internal — inference must go through withPreparedModel / withEmbeddingModel,
// which also serialize the completion itself (one llama context can't run two
// generations, and a different-id prepare would unload a context mid-generation).
async function getPreparedModel(id: string): Promise<PreparedModel> {
  if (preparing) {
    await preparing.catch(() => {});
  }
  if (prepared?.id === id) {
    return prepared.model;
  }
  const spec = specOrThrow(id);
  preparing = (async () => {
    await releaseModel();
    const model: PreparedModel =
      spec.capability === "embedding"
        ? // DORMANT: on-device embedding is no longer used. "Ask my posts" now
          // embeds the query server-side and ranks against the worker's gemini
          // vectors synced into post_vectors (see lib/research/ask + sync/
          // reconcile), because on-device document indexing crashed the encoder
          // (the segfault below) and was slow. Nothing downloads the nomic model
          // or calls withEmbeddingModel anymore, so this branch is unreachable —
          // kept (with its hard-won crash fixes) for a future fully-offline mode.
          //
          // nomic-embed is a non-causal ENCODER. Two native crashes to avoid here,
          // both in the encode() graph for this BERT model:
          //   1. llama.cpp asserts `n_ubatch >= n_tokens` (an encoder can't split a
          //      sequence across micro-batches). The lib default n_ubatch is 512,
          //      but a long input past ~512 tokens overruns it; in the optimized
          //      build the
          //      assert is compiled out so it segfaults in llama_batch_allocr::init.
          //      Fix: size n_ctx + both batch dims to 4096 so a whole 4000-char
          //      input (tokens <= chars) always fits one ubatch (nomic-embed-v1.5
          //      supports long context, so this is within spec).
          //   2. flash_attn_type defaults to "auto", which picks flash attention for
          //      the nomic-BERT attention graph and then aborts in
          //      lm_ggml_flash_attn_ext_set_prec (SIGABRT, llama-graph build_attn_mha).
          //      Flash attn is a no-op win for a tiny embedding model, so force it
          //      "off" → the standard attention path, which is supported here.
          llama.textEmbeddingModel(getModelPath(spec.hfPath), {
            contextParams: {
              n_ctx: 4096,
              n_batch: 4096,
              n_ubatch: 4096,
              flash_attn_type: "off",
            },
          })
        : llama.languageModel(getModelPath(spec.hfPath), {
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

// Inference mutex. The native llama context runs exactly one completion at a
// time, and nothing at the native layer guards against overlap — this queue
// is the guard. It covers prepare + completion as one critical section, so a
// model swap (releaseModel inside getPreparedModel) can never unload a
// context that another caller is still generating with. Same promise-chain
// pattern as outbox.ts's flush serialization.
// "embed-query" = embedding a single chat query; "embed-index" = a batch chunk of
// the post-vector index build. Both share the one resident slot + mutex below.
export type ModelHolder = "chat" | "draft" | "embed-query" | "embed-index";

let inferenceChain: Promise<unknown> = Promise.resolve();
let holder: ModelHolder | null = null;

// Who currently holds the model (null = idle). Lets the chat screen show
// "waiting for the post drafter…" instead of silently queueing.
export function modelBusyBy(): ModelHolder | null {
  return holder;
}

// The one critical section: prepare (loading/swapping if needed) + run `fn`,
// serialized against every other on-device inference. Callers queue FIFO; a
// rejection in one caller's fn never breaks the chain for the next. This is the
// single guarantee that the native llama context never runs two operations at
// once and that a model swap can't unload a context another caller is using.
function runExclusive<T>(
  id: string,
  who: ModelHolder,
  fn: (model: PreparedModel) => Promise<T>,
): Promise<T> {
  const run = inferenceChain
    .catch(() => {})
    .then(async () => {
      holder = who;
      try {
        const model = await getPreparedModel(id);
        return await fn(model);
      } finally {
        holder = null;
      }
    });
  inferenceChain = run.catch(() => {});
  return run;
}

// Prepares a text/vision (language) model and runs `fn` with it. The cast is safe:
// getPreparedModel builds a LlamaLanguageModel for any non-"embedding" spec, and
// callers pass a matching id + holder ("chat" / "draft").
export function withPreparedModel<T>(
  id: string,
  who: ModelHolder,
  fn: (model: LlamaLanguageModel) => Promise<T>,
): Promise<T> {
  return runExclusive(id, who, (model) => fn(model as LlamaLanguageModel));
}

// Prepares the embedding model and runs `fn` with it, in the same critical section
// as chat/draft so an embed pass and a chat turn never contend for the GPU. The
// cast mirrors withPreparedModel: an "embedding" spec yields a LlamaEmbeddingModel.
export function withEmbeddingModel<T>(
  id: string,
  who: ModelHolder,
  fn: (model: LlamaEmbeddingModel) => Promise<T>,
): Promise<T> {
  return runExclusive(id, who, (model) => fn(model as LlamaEmbeddingModel));
}

// Warm the resident model ahead of the first user turn. Runs a 1-token completion
// inside the inference mutex so the context is prepared (loaded + KV initialized)
// before the user sends — the first reply then streams without the cold-load pause.
// Best-effort: any failure (model not ready, bridge missing) is swallowed; the
// real send path surfaces a legible error. No-op cost when already warm: the
// mutex + getPreparedModel short-circuit on the resident model.
export async function prewarm(id: string): Promise<void> {
  try {
    await withPreparedModel(id, "chat", async (model) => {
      const { textStream } = streamText({
        model,
        prompt: "Reply with the single word: ready",
        // A hard ceiling so warm-up can't run away; we only need the prefill.
        maxOutputTokens: 1,
      });
      // Drain (one token) via the iterator protocol — no binding, so lint-clean.
      const iter = textStream[Symbol.asyncIterator]();
      await iter.next();
      await iter.return?.();
    });
  } catch {
    // Warm-up is best-effort; never throw to the screen.
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
