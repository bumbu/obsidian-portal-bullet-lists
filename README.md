# Dependency Bullet Lists

A custom Obsidian plugin scaffold for dependency-style bullet lists.

## Included behaviors

- Only enables itself for markdown files with a `tasks-dependency-list` frontmatter property.
- Marks leaf list items with a visual leaf emoji.
- Adds hidden `dbbl-*` IDs only when a bullet is referenced by a portal, using incremental IDs such as `dbbl-1`, `dbbl-2`, and so on.
- Supports `[[#^dbbl-...]]` portal links and an `@` suggestion flow for choosing portal targets from the current document.
- Re-renders portal targets as lists in reading mode, including nested portals.
  Circular references are shown as a warning instead of expanding indefinitely.

## Development

1. Install dependencies with `npm install`.
2. Run `npm run dev` to rebuild the plugin when source files change.
3. Run `npm run typecheck` to check the TypeScript source.
4. Run `npm run build` to create the production `main.js`.
5. Run `node --test tests/portal-rendering.test.cjs` to check portal rendering logic.

The plugin entry point is `main.ts`. Obsidian loads `main.js`, `manifest.json`, and `styles.css` from this folder.
