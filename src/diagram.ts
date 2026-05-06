export interface DiagramInput {
  app: string;
  inbound: string[];
  outbound: string[];
  internal?: string[];
}

function cpLen(s: string): number {
  return [...s].length;
}

function cpPad(s: string, width: number, char = " "): string {
  const cps = [...s];
  const n = Math.min(cps.length, width);
  return cps.slice(0, n).join("") + char.repeat(width - n);
}

function splitLabel(text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (cpLen(candidate) <= maxW) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = [...word].slice(0, maxW).join("");
    }
  }
  if (current) lines.push(current);
  return lines;
}

const BOX_LEFT = 28;
const BOX_INTERIOR = 18;
const CONNECTOR_COL = 37;
const LABEL_MAX_W = 14;
const INTERNAL_INDENT = 31;
const SIMPLE_INTERNAL_LABEL_INDENT = 62;

function buildRows(
  N: number,
  inbound: string[],
  outbound: string[],
  appLines: string[],
  appStart: number,
): string[] {
  const rows: string[] = [];
  for (let i = 0; i < N; i++) {
    const hasLeft = i < inbound.length;
    const hasRight = i < outbound.length;
    const appLineIdx = i - appStart;
    const interior =
      appLineIdx >= 0 && appLineIdx < appLines.length
        ? cpPad("   " + appLines[appLineIdx], BOX_INTERIOR)
        : " ".repeat(BOX_INTERIOR);

    if (hasLeft && hasRight) {
      rows.push(
        cpPad(inbound[i], 16) + "──────────► │" + interior + "│ ◄──────────  " + outbound[i]
      );
    } else if (hasLeft) {
      rows.push(cpPad(inbound[i], 16) + "──────────► │" + interior + "│");
    } else if (hasRight) {
      rows.push(" ".repeat(BOX_LEFT) + "│" + interior + "│ ◄──────────  " + outbound[i]);
    } else {
      rows.push(" ".repeat(BOX_LEFT) + "│" + interior + "│");
    }
  }
  return rows;
}

function renderSimple(opts: {
  app: string;
  inbound: string[];
  outbound: string[];
}): string {
  const N = Math.max(opts.inbound.length, opts.outbound.length);
  const appLines = splitLabel(opts.app, LABEL_MAX_W);
  const appStart = Math.floor((N - appLines.length) / 2);

  const rows: string[] = [];

  rows.push("External");
  rows.push(" ".repeat(BOX_LEFT) + "┌" + "─".repeat(BOX_INTERIOR) + "┐");

  rows.push(...buildRows(N, opts.inbound, opts.outbound, appLines, appStart));

  rows.push(" ".repeat(BOX_LEFT) + "└" + "─".repeat(BOX_INTERIOR) + "┘");
  rows.push(" ".repeat(SIMPLE_INTERNAL_LABEL_INDENT) + "Internal");

  return rows.join("\n");
}

function renderComplex(opts: {
  app: string;
  inbound: string[];
  outbound: string[];
  internal: string[];
}): string {
  const N = Math.max(opts.inbound.length, opts.outbound.length);
  const appLines = splitLabel(opts.app, LABEL_MAX_W);
  const appStart = Math.floor((N - appLines.length) / 2);

  const rows: string[] = [];

  rows.push("External" + " ".repeat(54) + "External");
  rows.push(" ".repeat(BOX_LEFT) + "┌" + "─".repeat(BOX_INTERIOR) + "┐");

  rows.push(...buildRows(N, opts.inbound, opts.outbound, appLines, appStart));

  rows.push(" ".repeat(BOX_LEFT) + "└" + "─".repeat(8) + "┬" + "─".repeat(9) + "┘");
  rows.push(" ".repeat(CONNECTOR_COL) + "│");
  rows.push(" ".repeat(CONNECTOR_COL) + "▼");

  for (const item of opts.internal) {
    rows.push(" ".repeat(INTERNAL_INDENT) + item);
  }

  rows.push("");
  rows.push(" ".repeat(INTERNAL_INDENT) + "Internal");

  return rows.join("\n");
}

export function renderDiagram(input: DiagramInput): string {
  if (input.internal && input.internal.length > 0) {
    return renderComplex({
      app: input.app,
      inbound: input.inbound,
      outbound: input.outbound,
      internal: input.internal,
    });
  }
  return renderSimple({
    app: input.app,
    inbound: input.inbound,
    outbound: input.outbound,
  });
}
