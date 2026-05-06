// ── Public types ──────────────────────────────────────────────────────────────

export interface DiagramInput {
  app: string;        // App name, shown inside the box
  inbound: string[];  // Left-side items (arrows point right into box)
  outbound: string[]; // Right-side items (arrows point left into box)
  internal?: string[]; // Optional internal items below box
}

// ── Codepoint-safe helpers ────────────────────────────────────────────────────

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

// ── renderSimple ──────────────────────────────────────────────────────────────

function renderSimple(opts: {
  app: string;
  inbound: string[];
  outbound: string[];
}): string {
  const N = Math.max(opts.inbound.length, opts.outbound.length);
  const appLines = splitLabel(opts.app, 14);
  const appStart = Math.floor((N - appLines.length) / 2);

  const rows: string[] = [];

  rows.push("External");
  rows.push(" ".repeat(28) + "┌" + "─".repeat(18) + "┐");

  for (let i = 0; i < N; i++) {
    const hasLeft = i < opts.inbound.length;
    const hasRight = i < opts.outbound.length;
    const appLineIdx = i - appStart;
    const interior =
      appLineIdx >= 0 && appLineIdx < appLines.length
        ? cpPad("   " + appLines[appLineIdx], 18)
        : " ".repeat(18);

    if (hasLeft && hasRight) {
      rows.push(
        cpPad(opts.inbound[i], 16) + "──────────► │" + interior + "│ ◄──────────  " + opts.outbound[i]
      );
    } else if (hasLeft) {
      rows.push(
        cpPad(opts.inbound[i], 16) + "──────────► │" + interior + "│"
      );
    } else if (hasRight) {
      rows.push(
        " ".repeat(28) + "│" + interior + "│ ◄──────────  " + opts.outbound[i]
      );
    } else {
      rows.push(
        " ".repeat(28) + "│" + interior + "│"
      );
    }
  }

  rows.push(" ".repeat(28) + "└" + "─".repeat(18) + "┘");
  rows.push(" ".repeat(62) + "Internal");

  return rows.join("\n");
}

// ── renderComplex ─────────────────────────────────────────────────────────────

function renderComplex(opts: {
  app: string;
  inbound: string[];
  outbound: string[];
  internal: string[];
}): string {
  const N = Math.max(opts.inbound.length, opts.outbound.length);
  const appLines = splitLabel(opts.app, 14);
  const appStart = Math.floor((N - appLines.length) / 2);

  const rows: string[] = [];

  rows.push("External" + " ".repeat(54) + "External");
  rows.push(" ".repeat(28) + "┌" + "─".repeat(18) + "┐");

  for (let i = 0; i < N; i++) {
    const hasLeft = i < opts.inbound.length;
    const hasRight = i < opts.outbound.length;
    const appLineIdx = i - appStart;
    const interior =
      appLineIdx >= 0 && appLineIdx < appLines.length
        ? cpPad("   " + appLines[appLineIdx], 18)
        : " ".repeat(18);

    if (hasLeft && hasRight) {
      rows.push(
        cpPad(opts.inbound[i], 16) + "──────────► │" + interior + "│ ◄──────────  " + opts.outbound[i]
      );
    } else if (hasLeft) {
      rows.push(
        cpPad(opts.inbound[i], 16) + "──────────► │" + interior + "│"
      );
    } else if (hasRight) {
      rows.push(
        " ".repeat(28) + "│" + interior + "│ ◄──────────  " + opts.outbound[i]
      );
    } else {
      rows.push(
        " ".repeat(28) + "│" + interior + "│"
      );
    }
  }

  // ┬ connector at position 37 (BOX_START=28, 1 border, 8 dashes, ┬)
  rows.push(" ".repeat(28) + "└" + "─".repeat(8) + "┬" + "─".repeat(9) + "┘");
  rows.push(" ".repeat(37) + "│");
  rows.push(" ".repeat(37) + "▼");

  for (const item of opts.internal) {
    rows.push(" ".repeat(31) + item);
  }

  rows.push("");
  rows.push(" ".repeat(31) + "Internal");

  return rows.join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────────

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
