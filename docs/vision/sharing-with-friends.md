# Vision: Sharing material with friends

_Status: vision only — for future planning. Not a spec, no implementation commitment._
_Captured: 2026-06-15_

## The idea

Today everything you capture is yours alone (private) or out in the world (public
catalog). There's no in-between. This adds a **middle tier**: share your stuff with
specific people you trust.

Think of it as: _the Tinder of your brain dump_ — but now you can pass the good ones to a
friend.

## How it should feel

1. **Connect.** You and another user become connected the social way — one sends a request,
   the other accepts. Mutual, both sides opt in. No surprise additions.
2. **Sort into circles.** Once connected, you drop people into named circles ("work",
   "close friends", whatever). Circles are how you decide _who sees what_ without thinking
   about it every time.
3. **Share a post.** When you've got a finished post you like, you share it to a circle.
   What goes across is the **post plus its sources** — the finding/sight/blog _and_ the
   original URL/images behind it, as one bundle.
4. **They see it in a feed.** On the other side, shared stuff lands in a dedicated
   **"Shared with me"** feed. That's it. It does **not** mix into their library and does
   **not** get pulled into their Observatory/Tree.

## The four decisions (locked for this vision)

| Decision       | Choice                                                              |
| -------------- | ------------------------------------------------------------------- |
| Relationship   | **Circles** — named groups you sort people into                     |
| Consent        | **Connection first** — mutual accept, _then_ you can sort/share     |
| What's shared  | **Post + its sources** — the bundle, not just the polished text     |
| Recipient view | **Shared-with-me feed only** — kept separate from their own content |

## Guardrails (what this is NOT)

- **Not a social network.** No public follower counts, no comments, no likes (for now).
  Just trusted sharing.
- **Doesn't touch the Tree.** Other people's shared material never gets embedded or
  clustered into your Observatory/Tree. Your space stays yours.
- **Doesn't change publishing.** Sharing to a circle is separate from the public catalog.
  A post can be private, shared, and/or public independently.
- **Consent is real.** You can't be added to someone's content without accepting a
  connection first.

## Open questions for when we actually plan this

- How do people find each other to connect? (by handle? invite link?)
- How do you get notified of a connection request or a new share? (in-app badge? email?)
- Can the recipient "adopt" a shared item into their own library later if they want it?
- Web first, mobile first, or both?

_None of these need answering now — flagged so the future spec knows where to start._
