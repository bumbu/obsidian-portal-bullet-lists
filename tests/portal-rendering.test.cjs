const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

class Element {
  constructor() {
    this.children = [];
    this.attributes = {};
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  querySelectorAll() {
    return this.children.flatMap((child) =>
      child instanceof Link ? [child] : child instanceof Element ? child.querySelectorAll() : [],
    );
  }

  replaceWith(replacement) {
    const index = this.parent.children.indexOf(this);
    this.parent.children[index] = replacement;
    replacement.parent = this.parent;
  }

  append(child) {
    child.parent = this;
    this.children.push(child);
  }
}

class Link extends Element {
  constructor(id) {
    super();
    this.attributes.href = `#^${id}`;
  }
}

class TFile {}
const rendered = [];
const obsidian = {
  Plugin: class {
    registerMarkdownPostProcessor() {}
    registerEditorSuggest(suggest) {
      this.suggest = suggest;
    }
  },
  EditorSuggest: class {},
  MarkdownRenderChild: class {
    constructor(container) { this.containerEl = container; }
    registerDomEvent() {}
    registerEvent() {}
  },
  TFile,
  MarkdownRenderer: {
    async render(_app, markdown, wrapper) {
      rendered.push(markdown);
      for (const match of markdown.matchAll(/\[\[#\^([A-Za-z0-9-]+)\]\]/g)) {
        wrapper.append(new Link(match[1]));
      }
    },
  },
};

const source = fs.readFileSync(path.join(__dirname, "..", "main.ts"), "utf8");
const code = ts.transpileModule(source + "\nexports.testHelpers = { countPortalReferences, markReferencedItems, isPortalPlaceholder, ReferenceGutter };", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText;
const moduleStub = { exports: {} };
vm.runInNewContext(code, {
  module: moduleStub,
  exports: moduleStub.exports,
  require: (name) => {
    assert.equal(name, "obsidian");
    return obsidian;
  },
  document: {
    createElement: () => new Element(),
    createTextNode: (text) => ({ textContent: text }),
  },
  ResizeObserver: class { observe() {} disconnect() {} },
  MutationObserver: class { observe() {} disconnect() {} },
});
const Plugin = moduleStub.exports.default;
const { countPortalReferences, markReferencedItems, isPortalPlaceholder, ReferenceGutter } = moduleStub.exports.testHelpers;

function createPlugin(markdown) {
  const file = new TFile();
  const plugin = new Plugin();
  plugin.app = {
    vault: {
      getAbstractFileByPath: () => file,
      read: async () => markdown,
      cachedRead: async () => markdown,
    },
  };
  return plugin;
}

test("counts only direct same-note wikilink references, including aliases", () => {
  const counts = countPortalReferences({ links: [
    { link: "#^dbbl-1", original: "[[#^dbbl-1]]" },
    { link: "#^dbbl-1", original: "[[#^dbbl-1|alias]]" },
    { link: "#^dbbl-2", original: "[[#^dbbl-2]]" },
    { link: "Other#^dbbl-1", original: "[[Other#^dbbl-1]]" },
    { link: "#heading", original: "[[#heading]]" },
    { link: "#^dbbl-1", original: "[link](#^dbbl-1)" },
  ], embeds: [{ link: "#^dbbl-1", original: "![[#^dbbl-1]]" }] });
  assert.equal(counts.get("dbbl-1"), 2);
  assert.equal(counts.get("dbbl-2"), 1);
  assert.equal(counts.size, 2);
});

test("maps source list items to their corresponding rendered items", () => {
  const elements = [{ dataset: {} }, { dataset: {} }, { dataset: {} }];
  const cache = { listItems: [
    { position: { start: { line: 2 } }, id: "dbbl-1" },
    { position: { start: { line: 3 } } },
    { position: { start: { line: 4 } }, id: "dbbl-2" },
    { position: { start: { line: 8 } }, id: "outside" },
  ] };
  markReferencedItems({ querySelectorAll: () => elements }, cache, 2, 4);
  assert.equal(elements[0].dataset.dbblReferenceId, "dbbl-1");
  assert.equal(elements[1].dataset.dbblReferenceId, undefined);
  assert.equal(elements[2].dataset.dbblReferenceId, "dbbl-2");
});

test("portal-only placeholders do not create an extra badge for the mirrored root", () => {
  const makeItem = (text, hasRoot = true, nested = false) => {
    const item = {
      querySelectorAll: () => [portal],
      cloneNode: () => ({ textContent: text, querySelectorAll: () => [] }),
    };
    const portal = {
      closest: () => nested ? {} : item,
      querySelector: () => hasRoot ? {} : null,
    };
    return item;
  };
  assert.equal(isPortalPlaceholder(makeItem("")), true);
  assert.equal(isPortalPlaceholder(makeItem("Prefix")), false);
  assert.equal(isPortalPlaceholder(makeItem("", false)), false);
  assert.equal(isPortalPlaceholder(makeItem("", true, true)), false);
});

test("gutter shows all items including zero counts and refreshes on metadata changes", () => {
  let pending;
  let onChanged;
  const win = {
    requestAnimationFrame: (fn) => { pending = fn; return 1; },
    cancelAnimationFrame: () => {},
  };
  const doc = { defaultView: win, createElement: () => ({
    style: { setProperty(name, value) { this[name] = value; } }, setAttribute(name, value) { this[name] = value; },
    append(child) { (this.children ??= []).push(child); },
    replaceChildren() { this.children = []; },
    remove() {},
  }) };
  const item = (id, top) => ({
    dataset: { dbblReferenceId: id },
    querySelectorAll: () => [],
    getClientRects: () => [1],
    getBoundingClientRect: () => ({ top }),
  });
  const placeholder = item(undefined, 190);
  const portal = { closest: () => placeholder, querySelector: () => ({}) };
  placeholder.querySelectorAll = () => [portal];
  placeholder.cloneNode = () => ({ textContent: "", querySelectorAll: () => [] });
  const items = [item("dbbl-1", 110), item("dbbl-2", 150), placeholder, item("dbbl-1", 190), item("unused", 220), item(undefined, 250)];
  const container = {
    ownerDocument: doc,
    classList: { add() {}, remove() {} },
    prepend(el) { this.gutter = el; },
    querySelectorAll: () => items,
    getBoundingClientRect: () => ({ top: 100 }),
  };
  let cache = { links: [
    { link: "#^dbbl-1", original: "[[#^dbbl-1]]" },
    { link: "#^dbbl-1", original: "[[#^dbbl-1]]" },
    { link: "#^dbbl-2", original: "[[#^dbbl-2]]" },
  ] };
  const file = { path: "note.md" };
  const app = { metadataCache: {
    getFileCache: () => cache,
    on: (_, fn) => { onChanged = fn; return {}; },
  } };
  const gutter = new ReferenceGutter(container, app, file);
  gutter.onload();
  pending();
  assert.deepEqual(container.gutter.children.map((badge) => [badge.children[0].textContent, badge.style.top]), [
    ["2", "10px"], ["1", "50px"], ["2", "90px"], ["0", "120px"], ["0", "150px"],
  ]);
  assert.equal(container.gutter.children[0].title, "Referenced 2 times");
  assert.deepEqual(container.gutter.children.map((badge) => Number(badge.style["--dbbl-reference-intensity"])), [
    0.24, 0.18, 0.24, 0, 0,
  ]);
  cache = { links: [{ link: "#^dbbl-2", original: "[[#^dbbl-2]]" }] };
  onChanged(file);
  pending();
  assert.deepEqual(container.gutter.children.map((badge) => [badge.children[0].textContent, badge.style.top]), [
    ["0", "10px"], ["1", "50px"], ["0", "90px"], ["0", "120px"], ["0", "150px"],
  ]);
  assert.equal(Number(container.gutter.children[0].style["--dbbl-reference-intensity"]), 0);
  assert.equal(Number(container.gutter.children[1].style["--dbbl-reference-intensity"]), 0.18);
  cache = { links: Array.from({ length: 20 }, () => ({ link: "#^dbbl-1", original: "[[#^dbbl-1]]" })) };
  onChanged(file);
  pending();
  assert.equal(Number(container.gutter.children[0].style["--dbbl-reference-intensity"]), 0.55);
  gutter.onunload();
});

test("suggestions exclude portal and link bullets but keep ordinary bullets with links", async () => {
  const markdown = [
    "- [[#^dbbl-1]]",
    "- [[#^dbbl-2|Portal]] ^dbbl-9",
    "- See [[#^dbbl-1]]",
    "- [[Other note]]",
    "- [External](https://example.com)",
    "- https://example.com",
    "- <https://example.com>",
    "- [ ] [[#^dbbl-1]]",
    "- [x] [[Other note]]",
    "- Regular item ^dbbl-3",
    "- Read [[Other note]]",
    "- Refer to [documentation](https://example.com)",
  ].join("\n");
  const plugin = createPlugin(markdown);
  await plugin.onload();

  const context = {
    file: new TFile(),
    editor: { getValue: () => markdown },
    start: { line: 0, ch: 0 },
    query: "",
  };
  const suggestions = await plugin.suggest.getSuggestions(context);
  assert.deepEqual(Array.from(suggestions, (item) => item.label), [
    "Regular item",
    "Read [[Other note]]",
    "Refer to [documentation](https://example.com)",
  ]);
  assert.equal(suggestions[0].id, "dbbl-3");
  const filtered = await plugin.suggest.getSuggestions({ ...context, query: "REGULAR" });
  assert.deepEqual(Array.from(filtered, (item) => item.label), ["Regular item"]);
});

test("suggestions exclude the current bullet using unsaved editor line positions", async () => {
  const saved = "- Same\n- Target";
  const markdown = "- New unsaved bullet\n- Same @\n- Same @\n- Target";
  const plugin = createPlugin(saved);
  await plugin.onload();
  const context = {
    file: new TFile(),
    editor: { getValue: () => markdown },
    start: { line: 1, ch: 7 },
    query: "",
  };

  const suggestions = await plugin.suggest.getSuggestions(context);
  assert.deepEqual(Array.from(suggestions, (item) => item.lineIndex), [0, 2, 3]);
  assert.deepEqual(Array.from(suggestions, (item) => item.label), ["New unsaved bullet", "Same @", "Target"]);

  const filtered = await plugin.suggest.getSuggestions({ ...context, query: "same" });
  assert.deepEqual(Array.from(filtered, (item) => item.lineIndex), [2]);
});

test("excludes the current bullet before applying the suggestion limit", async () => {
  const markdown = Array.from({ length: 11 }, (_, i) => `- Item ${i}`).join("\n");
  const plugin = createPlugin(markdown);
  await plugin.onload();
  const suggestions = await plugin.suggest.getSuggestions({
    file: new TFile(),
    editor: { getValue: () => markdown },
    start: { line: 0, ch: 0 },
    query: "",
  });

  assert.deepEqual(Array.from(suggestions, (item) => item.lineIndex), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("dedents nested targets while retaining relative indentation and continuation text", () => {
  const plugin = createPlugin("");
  const markdown = [
    "- Parent",
    "\t- Target ^dbbl-1",
    "\t\t- Child",
    "\t\t\t- Grandchild",
    "\t\t  continuation",
    "\t- Sibling",
  ].join("\n");
  assert.equal(
    plugin.findListSubtree(markdown, "dbbl-1"),
    "- Target ^dbbl-1\n    - Child\n        - Grandchild\n      continuation",
  );
  assert.equal(plugin.findListSubtree("- Root ^dbbl-2\n  - Child", "dbbl-2"), "- Root ^dbbl-2\n  - Child");
});

test("renders nested portals as dedented lists and allows repeated references", async () => {
  rendered.length = 0;
  const markdown = [
    "- Root",
    "    - Outer ^dbbl-1",
    "        - [[#^dbbl-2]]",
    "        - [[#^dbbl-2]]",
    "    - Inner ^dbbl-2",
    "        - Leaf",
  ].join("\n");
  const root = new Element();
  root.append(new Link("dbbl-1"));

  await createPlugin(markdown).renderPortalTargets(root, "note.md");

  assert.deepEqual(rendered, [
    "- Outer ^dbbl-1\n    - [[#^dbbl-2]]\n    - [[#^dbbl-2]]",
    "- Inner ^dbbl-2\n    - Leaf",
    "- Inner ^dbbl-2\n    - Leaf",
  ]);
  assert.equal(root.children[0].children.length, 2);
  assert.equal(root.children[0].children[0].className, "dbbl-portal");
  assert.equal(root.children[0].children[1].className, "dbbl-portal");
});

test("reports circular portal references instead of recursing indefinitely", async () => {
  rendered.length = 0;
  const markdown = "- A ^dbbl-1\n  - [[#^dbbl-2]]\n- B ^dbbl-2\n  - [[#^dbbl-1]]";
  const root = new Element();
  root.append(new Link("dbbl-1"));

  await createPlugin(markdown).renderPortalTargets(root, "note.md");

  assert.equal(rendered.length, 2);
  assert.equal(root.children[0].children[0].children[0].textContent, "[circular portal: #^dbbl-1]");
});
