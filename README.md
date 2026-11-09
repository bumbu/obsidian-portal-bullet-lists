# Dependency Bullet Lists

A custom Obsidian plugin scaffold for dependency-style bullet lists.

## Included behaviors

- Only enables itself for markdown files with a `tasks-dependency-list` frontmatter property.
- Marks leaf list items with a visual leaf emoji.
- Adds Obsidian block IDs only when a bullet is referenced by a portal. IDs are based on the task text (for example, `^change-radiators`); duplicates receive a numeric suffix. Unsupported characters are replaced or removed, and an empty result uses `item`.
- Supports `[[#^change-radiators]]` portal links and an `@` suggestion flow for choosing portal targets from the current document. Existing IDs, including `dbbl-*` IDs, remain supported. The current bullet, portal bullets, and link-only bullets are excluded from suggestions.
- Re-renders portal targets as lists in reading mode, including nested portals.
  Circular references are shown as a warning instead of expanding indefinitely.
- In reading mode, every list item has a circular badge in the left gutter showing the number of direct same-note portal links to it, including zero for unreferenced items. Its accent background becomes stronger as the count increases, up to a capped intensity. Badges share a column regardless of nesting and appear on mirrored tasks too. Expanded copies do not increase the count.

## Development

1. Install dependencies with `npm install`.
2. Run `npm run dev` to rebuild the plugin when source files change.
3. Run `npm run typecheck` to check the TypeScript source.
4. Run `npm run build` to create the production `main.js`.
5. Run `node --test tests/portal-rendering.test.cjs` to check portal rendering logic.

The plugin entry point is `main.ts`. Obsidian loads `main.js`, `manifest.json`, and `styles.css` from this folder.
