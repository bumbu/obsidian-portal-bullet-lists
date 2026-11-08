import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  MarkdownPostProcessorContext,
  Plugin,
  TFile,
} from "obsidian";

const REQUIREMENT_KEY = "tasks-dependency-list";
const LEAF_EMOJI = "🌿";
const ID_PREFIX = "dbbl";

interface BulletCandidate {
  id: string | null;
  label: string;
  lineIndex: number;
}

function hasFrontmatterFlag(frontmatter: Record<string, any> | null | undefined): boolean {
  return !!frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, REQUIREMENT_KEY);
}

function stripBlockId(text: string): string {
  return text.replace(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/, "").replace(/\s{2,}/g, " ").trim();
}

function parseBulletCandidates(markdown: string): BulletCandidate[] {
  const lines = markdown.split(/\r?\n/);
  const items: BulletCandidate[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (!match) continue;

    const rawText = match[1].trim();
    const blockMatch = rawText.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/);
    const label = stripBlockId(rawText);
    if (!label) continue;

    items.push({
      id: blockMatch ? blockMatch[1] : null,
      label,
      lineIndex: index,
    });
  }

  return items;
}

function nextBlockId(markdown: string): string {
  let highest = 0;
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/);
    if (!match) continue;
    const numeric = Number(match[1].replace(new RegExp(`^${ID_PREFIX}-?`, "i"), ""));
    if (!Number.isNaN(numeric)) highest = Math.max(highest, numeric);
  }
  return `${ID_PREFIX}-${highest + 1}`;
}

function extractSubtreeLines(lines: string[], startIndex: number): { text: string; endIndex: number } | null {
  if (startIndex >= lines.length) return null;

  const startLine = lines[startIndex];
  const match = startLine.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
  if (!match) return null;

  const baseIndent = startLine.match(/^\s*/)?.[0].length ?? 0;
  const subtree: string[] = [startLine];
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index];
    const listMatch = line.match(/^\s*(?:[-*+]|\d+\.)\s+/);
    const indent = line.match(/^\s*/)?.[0].length ?? 0;

    if (!line.trim()) {
      subtree.push(line);
      index += 1;
      continue;
    }

    if (listMatch && indent > baseIndent) {
      subtree.push(line);
      index += 1;
      continue;
    }

    if (listMatch && indent <= baseIndent) {
      break;
    }

    subtree.push(line);
    index += 1;
  }

  return { text: subtree.join("\n"), endIndex: index };
}

function renderSubtreeToText(subtree: string): string {
  return subtree
    .split(/\r?\n/)
    .map((line) => line.replace(/\s*\^([A-Za-z0-9-]+)\s*$/, "").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function renderSubtreeToList(subtree: string): HTMLUListElement | null {
  const lines = subtree.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const root = document.createElement("ul");

  const parse = (index: number, indent: number): number => {
    while (index < lines.length) {
      const line = lines[index];
      const listMatch = line.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/);
      if (!listMatch) break;

      const currentIndent = listMatch[1].length;
      if (currentIndent < indent) break;
      if (currentIndent > indent) {
        const lastItem = root.lastElementChild as HTMLLIElement | null;
        if (!lastItem) break;
        const nested = document.createElement("ul");
        const childIndex = parse(index, currentIndent);
        const nestedLines = lines.slice(index, childIndex);
        for (const nestedLine of nestedLines) {
          const nestedMatch = nestedLine.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/);
          if (!nestedMatch) continue;
          const nestedItem = document.createElement("li");
          nestedItem.textContent = stripBlockId(nestedMatch[2].trim());
          nested.appendChild(nestedItem);
        }
        lastItem.appendChild(nested);
        index = childIndex;
        continue;
      }

      const item = document.createElement("li");
      const text = stripBlockId(listMatch[2].trim());
      item.textContent = text;
      root.appendChild(item);
      index += 1;

      const next = index < lines.length ? lines[index] : "";
      const nextMatch = next.match(/^(\s*)(?:[-*+]|\d+\.)\s+/);
      if (nextMatch && nextMatch[1].length > indent) {
        const nested = document.createElement("ul");
        let cursor = index;
        while (cursor < lines.length) {
          const candidate = lines[cursor];
          const candidateMatch = candidate.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/);
          if (!candidateMatch) break;
          if (candidateMatch[1].length <= indent) break;
          const child = document.createElement("li");
          child.textContent = stripBlockId(candidateMatch[2].trim());
          nested.appendChild(child);
          cursor += 1;
        }
        item.appendChild(nested);
        index = cursor;
      }
    }

    return index;
  };

  const firstLine = lines[0];
  const firstMatch = firstLine.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/);
  if (!firstMatch) return null;

  parse(0, firstMatch[1].length);
  return root;
}

class DependencyBulletSuggest extends EditorSuggest<BulletCandidate> {
  constructor(app: App, private readonly plugin: DependencyBulletListsPlugin) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): { start: EditorPosition; end: EditorPosition; query: string } | null {
    if (!file || !this.plugin.isDependencyPage(file)) {
      return null;
    }

    const currentLine = editor.getLine(cursor.line);
    const beforeCursor = currentLine.slice(0, cursor.ch);
    const match = beforeCursor.match(/(?:^|\s)@([A-Za-z0-9-_]*)$/);
    if (!match) {
      return null;
    }

    const query = match[1];
    return {
      start: { line: cursor.line, ch: cursor.ch - query.length - 1 },
      end: cursor,
      query,
    };
  }

  async getSuggestions(context: EditorSuggestContext): Promise<BulletCandidate[]> {
    const markdown = await this.plugin.getFileMarkdown(context.file);
    return parseBulletCandidates(markdown)
      .filter((item) => item.label.toLowerCase().includes(context.query.toLowerCase()))
      .slice(0, 10);
  }

  renderSuggestion(item: BulletCandidate, el: HTMLElement): void {
    el.addClass("dbbl-suggestion-item");
    el.setText(item.label);
  }

  selectSuggestion(item: BulletCandidate, evt: MouseEvent | KeyboardEvent): void {
    if (!this.context) return;

    const targetId = this.plugin.ensureBulletId(this.context.editor, item);
    this.context.editor.replaceRange(`[[#^${targetId}]]`, this.context.start, this.context.end);
  }
}

export default class DependencyBulletListsPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerMarkdownPostProcessor((el, ctx) => this.renderDependencyBullets(el, ctx));
    this.registerEditorSuggest(new DependencyBulletSuggest(this.app, this));
  }

  onunload(): void {
    // Nothing additional to clean up.
  }

  isDependencyPage(file: TFile | null | undefined): boolean {
    if (!file) return false;
    const cache = this.app.metadataCache.getFileCache(file);
    return hasFrontmatterFlag(cache?.frontmatter ?? null);
  }

  async getFileMarkdown(file: TFile): Promise<string> {
    return this.app.vault.cachedRead(file);
  }

  ensureBulletId(editor: Editor, item: BulletCandidate): string {
    if (item.id) return item.id;

    const markdown = editor.getValue();
    const lines = markdown.split(/\r?\n/);
    const line = lines[item.lineIndex];
    const nextId = nextBlockId(markdown);

    if (!line) return nextId;

    const updated = `${line} ^${nextId}`;
    editor.replaceRange(updated, { line: item.lineIndex, ch: 0 }, { line: item.lineIndex, ch: line.length });
    return nextId;
  }

  async renderDependencyBullets(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    if (!hasFrontmatterFlag(ctx.frontmatter ?? null)) return;

    this.decorateLeafBullets(el);
    await this.renderPortalTargets(el, ctx.sourcePath);
  }

  decorateLeafBullets(el: HTMLElement): void {
    const listItems = el.querySelectorAll("li");
    for (const item of Array.from(listItems)) {
      const nestedList = item.querySelector(":scope > ul, :scope > ol");
      if (nestedList) continue;

      const content = item.querySelector(":scope > .list-bullet, :scope > .list-li-content, :scope > p");
      if (!content) continue;

      const marker = document.createElement("span");
      marker.className = "dbbl-leaf-marker";
      marker.textContent = LEAF_EMOJI;
      marker.setAttribute("aria-hidden", "true");
      content.prepend(marker);
    }
  }

  async renderPortalTargets(el: HTMLElement, sourcePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof TFile)) return;

    const source = await this.app.vault.read(file);
    const candidates = Array.from(el.querySelectorAll("a.internal-link, span.internal-link"));

    for (const link of candidates) {
      const href = link.getAttribute("href") ?? link.getAttribute("data-href") ?? "";
      const portalId = href.match(/#\^?([A-Za-z0-9-]+)/)?.[1];
      if (!portalId) continue;

      const subtree = this.findListSubtree(source, portalId);
      if (!subtree) {
        link.replaceWith(document.createTextNode("[missing portal]"));
        continue;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "dbbl-portal";
      const rendered = renderSubtreeToList(subtree);
      if (rendered) {
        wrapper.appendChild(rendered);
      } else {
        wrapper.textContent = renderSubtreeToText(subtree);
      }
      link.replaceWith(wrapper);
    }
  }

  findListSubtree(markdown: string, id: string): string | null {
    const lines = markdown.split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const match = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
      if (!match) continue;

      const tail = match[1].trim();
      const idMatch = tail.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/);
      if (!idMatch || idMatch[1] !== id) continue;

      const subtree = extractSubtreeLines(lines, index);
      return subtree?.text ?? null;
    }

    return null;
  }

  findListItemById(markdown: string, id: string): string | null {
    for (const line of markdown.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
      if (!match) continue;
      const text = match[1].trim();
      const hiddenMatch = text.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/);
      if (hiddenMatch && hiddenMatch[1] === id) {
        return stripBlockId(text);
      }
    }
    return null;
  }
}
