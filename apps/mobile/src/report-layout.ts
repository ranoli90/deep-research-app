/** Layout helpers for M04: long text, tables, and code must not widen the whole screen. */

export function breakLongTokens(text: string, every = 24): string {
  return text.replace(/[^\s]{25,}/g, (token) => {
    const parts: string[] = [];
    for (let i = 0; i < token.length; i += every) parts.push(token.slice(i, i + every));
    return parts.join("\u200b");
  });
}

export function parseTable(text: string): string[][] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: string[][] = [];
  for (const line of lines) {
    if (/^[\s|:.-]+$/.test(line)) continue;
    if (line.includes("|")) {
      const cells = line.split("|").map((c) => c.trim());
      const trimmed = cells[0] === "" ? cells.slice(1) : cells;
      if (trimmed.at(-1) === "") trimmed.pop();
      if (trimmed.length > 0) rows.push(trimmed);
    } else if (line.includes("\t")) {
      rows.push(line.split("\t").map((c) => c.trim()));
    } else {
      rows.push([line]);
    }
  }
  return rows;
}

export function needsHorizontalScroll(kind: string): boolean {
  return kind === "code" || kind === "table";
}
