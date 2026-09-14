# Note path allocation

Game identity and note filename are separate concepts. `canonicalKey`, IGDB,
GameTrack and legacy provider IDs identify a game; a Markdown path is only the
current vault location of its note.

## Allocation rules

- A matched existing note always keeps its current path, including a path
  renamed manually by the user.
- A new game uses the sanitized title as its base filename.
- A new batch with duplicate normalized titles uses release-year suffixes when
  every colliding year is unique: `Dead Space (2008).md`.
- Duplicate titles with the same year use the year plus a stable identity:
  `Foo (2020) [igdb-1234].md`.
- Duplicate titles without a usable year use a stable identity directly:
  `Foo [igdb-1234].md`.
- IGDB is preferred for the stable suffix. GameTrack ID is the fallback, then
  the stable canonical key.
- An occupied base path is never overwritten. The allocator tries a semantic
  year candidate and then a stable-ID candidate.
- Paths are reserved during the whole plan and compared using normalized,
  case-insensitive path keys.

The allocator never uses platform names or duplicate counters as the primary
disambiguator. It does not rename an existing note to make a batch symmetric.

## Determinism and history

New games are ordered by normalized title, release year, IGDB ID and canonical
key before allocation. The same snapshot and vault state therefore produce the
same paths regardless of CSV row order.

An incremental import can intentionally produce a different result from a
fresh import. For example, if `Dead Space (2008)` was imported first, its
existing `Dead Space.md` path is preserved when `Dead Space (2023)` appears
later. Preserving paths and links has priority over globally symmetric naming.

Title changes also preserve an already matched path. A path is not a
canonical identity and is never rewritten merely because the provider title
changed.

## Conflict boundary

The allocator resolves path collisions between distinct, successfully matched
or newly imported games. It does not hide semantic conflicts such as duplicate
existing IGDB IDs, incompatible stable identities or ambiguous note matches;
those remain review-required planner conflicts.

The writer receives a fully allocated path and does not contain fallback
filename logic.
