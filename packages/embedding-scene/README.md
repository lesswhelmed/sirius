# `@repo/embedding-scene`

Host-agnostic core for the **embedding space** — the data and pure logic behind web's
`/space` **Observatory** (`apps/web/app/(app)/space/space-view.tsx`) and the mobile
**Tree** tab (`apps/mobile/src/app/(tabs)/tree.tsx`). Both hosts fetch the same scene from
`GET /api/app/embedding-scene` (session-authed, owner-scoped) and render it with the
shared types and queries here, so they can never disagree on the taxonomy or drill-in.

The package has **no host dependencies** in its core (`types.ts`, `scene-queries.ts`,
`build-scene.ts`, `pca.ts`) — just data in, data out. React/three.js bits live under
`react/` and are imported only by hosts that render the 3D scene.

## The wire format (`types.ts`)

```ts
EmbeddingScene = { nodes: SceneNode[]; edges: SceneEdge[]; modelVersion; dimensionality; generatedAt }
SceneNode  = { id; kind: "category" | "project" | "post"; label; position; path?; depth?; purpose?; slug?; projectId? }
SceneEdge  = { from; to; kind: "taxonomy" | "assignment" | "match"; weight? }
```

- **category** — `id === path` (e.g. `"analysis/artifact-type/social-post"`), `label` is the
  leaf segment; nesting is by path prefix. `taxonomy` edges link parent → child.
- **project** ("focus area") — posts attach via `assignment` edges (no weight).
- **post** — attaches to categories via `match` edges, `weight` = similarity score.

## Queries (`scene-queries.ts`) — pure, no API round-trips

| Export                        | Returns                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `categoryChildren(scene)`     | adjacency `Map<parentPath\|null, SceneNode[]>` for rendering the outline                                                                                            |
| `projectNodes(scene)`         | all project nodes, alphabetical                                                                                                                                     |
| `linkedPosts(scene, nodeId)`  | posts directly linked to one node (category `match`, best-first; project `assignment`, alpha)                                                                       |
| `subtreeIndex(scene, nodeId)` | posts under a node **and its whole subtree**, deduped one-per-post (best match) and grouped by the matched leaf category; `multiNode` flags when >1 group has posts |

## React helpers (`react/`)

- `react/use-scene-selection` — `useSceneSelection(scene)`: select/drill state shared by both hosts.
- `react/space-scene` — the three.js `<SpaceScene>` renderer (web `/space` + mobile `/space`).

## Producing a scene

`build-scene.ts` assembles an `EmbeddingScene` from category/project/post embeddings
(`pca.ts` projects high-dim vectors to 3D positions). The web API route
(`apps/web/app/api/app/embedding-scene/route.ts`) is the production producer.
