// PURE: choose the SINGLE primary category for a post.
//
// A post carries exactly one category — in both the flat Category table (the
// colophon label) and the hierarchical-embedding link (PostCategoryMatch). The
// primary must conform to the embedding taxonomy, so we prefer the strongest
// content-cosine match (`categories`, scored + sorted by classifyContent) and
// fall back to the model's first/most-representative resolved topic when nothing
// cleared the match floor (a freshly-grown topic IS the best embedding anchor we
// have for novel content). Every other proposed/resolved category is demoted to
// a tag by the caller.
//
// No I/O — keeps the decision unit-testable, mirroring decidePlacement/planPath
// in resolve-categories.ts.

// The minimal shape both CategoryMatch (classify.ts) and ResolvedTopic
// (resolve-categories.ts) satisfy.
export interface PrimaryCandidate {
	path: string;
	name: string;
	score: number;
}

// Returns the primary, or null when there are neither cosine matches nor
// resolved topics (the post links to no category — caller writes none).
export function selectPrimaryCategory(
	categories: PrimaryCandidate[],
	topics: PrimaryCandidate[],
): PrimaryCandidate | null {
	// Cosine matches are directly comparable; take the highest-scoring rather than
	// trusting upstream sort order.
	let best: PrimaryCandidate | null = null;
	for (const c of categories) {
		if (!best || c.score > best.score) {
			best = c;
		}
	}
	if (best) {
		return best;
	}
	// No match cleared the floor — anchor on the model's primary proposal.
	return topics[0] ?? null;
}
