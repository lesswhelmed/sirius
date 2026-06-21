// @repo/research-agent — host-agnostic core for an on-device "ask my posts"
// assistant. Embed a query on-device, rank the user's local post-vector index by
// cosine similarity, and stream a grounded answer that cites the matching posts.
//
// Platform-specific pieces (the embedding model, the language model, the vector
// store) are injected via the ports in ./ports. The mobile app composes the two
// phases itself (single resident model); a future web WebLLM client can use
// runResearchAgent directly (concurrent models). Nothing here imports a runtime.

export {
  type ResearchMode,
  type ResearchRun,
  type RunResearchArgs,
  runResearchAgent,
} from "./agent";
export {
  type AskAgentArgs,
  type AskAgentDeps,
  type AskAgentRun,
  type Candidate,
  runAskAgent,
} from "./ask-agent";
export {
  type ResearchStream,
  type StreamAnswerArgs,
  streamResearchAnswer,
} from "./answer";
export { cosineSim } from "./cosine";
export {
  DECIDE_SYSTEM_PROMPT,
  decideResearch,
  type ResearchDecision,
} from "./decide";
export { contentHash } from "./hash";
export type {
  FullPost,
  PostRef,
  PostVectorStore,
  ResearchPorts,
  ScoredPost,
  SearchPorts,
  StoredVector,
  VectorUpsert,
} from "./ports";
export {
  AGENT_SYSTEM_PROMPT,
  buildAnswerSystem,
  formatPostsBlock,
  SYSTEM_PROMPT,
} from "./prompt";
export {
  type GetPostInput,
  GetPostInputSchema,
  type PostSearchInput,
  PostSearchInputSchema,
  type PostSearchOutput,
  PostSearchOutputSchema,
  ScoredPostSchema,
} from "./schema";
export { type SearchOptions, searchPosts } from "./search";
export { createPostSearchTool, GET_POST_TOOL_NAME, POST_SEARCH_TOOL_NAME } from "./tool";
