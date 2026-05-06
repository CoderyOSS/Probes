import { describe, test, expect } from "bun:test";
import { renderDiagram } from "../src/diagram.js";
import type { DiagramInput } from "../src/diagram.js";

// ── Simple variant ─────────────────────────────────────────────────────────────

describe("renderDiagram (simple — no internal)", () => {
  const input: DiagramInput = {
    app: "MyApp",
    inbound: ["HTTP", "WebSocket"],
    outbound: ["SQL", "Redis"],
  };

  test("renders 'External' header (single, top-left)", () => {
    const out = renderDiagram(input);
    const lines = out.split("\n");
    expect(lines[0]).toBe("External");
  });

  test("does NOT render 'External' header twice on first line", () => {
    const out = renderDiagram(input);
    const lines = out.split("\n");
    // Simple variant: only one 'External' on the first line
    expect(lines[0].trim()).toBe("External");
    expect((lines[0].match(/External/g) ?? []).length).toBe(1);
  });

  test("renders box top border", () => {
    const out = renderDiagram(input);
    expect(out).toContain("┌" + "─".repeat(18) + "┐");
  });

  test("renders box bottom border", () => {
    const out = renderDiagram(input);
    expect(out).toContain("└" + "─".repeat(18) + "┘");
  });

  test("renders 'Internal' label at bottom-right", () => {
    const out = renderDiagram(input);
    const lines = out.split("\n");
    const last = lines[lines.length - 1];
    expect(last.trimEnd()).toContain("Internal");
  });

  test("renders inbound arrows (──────────►)", () => {
    const out = renderDiagram(input);
    expect(out).toContain("──────────►");
  });

  test("renders outbound arrows (◄──────────)", () => {
    const out = renderDiagram(input);
    expect(out).toContain("◄──────────");
  });

  test("renders inbound labels", () => {
    const out = renderDiagram(input);
    expect(out).toContain("HTTP");
    expect(out).toContain("WebSocket");
  });

  test("renders outbound labels", () => {
    const out = renderDiagram(input);
    expect(out).toContain("SQL");
    expect(out).toContain("Redis");
  });

  test("renders app name inside box", () => {
    const out = renderDiagram(input);
    expect(out).toContain("MyApp");
  });

  test("does NOT render ┬ connector in simple mode", () => {
    const out = renderDiagram(input);
    expect(out).not.toContain("┬");
  });
});

// ── Complex variant ────────────────────────────────────────────────────────────

describe("renderDiagram (complex — with internal)", () => {
  const input: DiagramInput = {
    app: "MyApp",
    inbound: ["HTTP", "WebSocket"],
    outbound: ["SQL"],
    internal: ["FileSystem", "Cache"],
  };

  test("renders 'External' header twice (both sides)", () => {
    const out = renderDiagram(input);
    const lines = out.split("\n");
    expect((lines[0].match(/External/g) ?? []).length).toBe(2);
  });

  test("renders box top border", () => {
    const out = renderDiagram(input);
    expect(out).toContain("┌" + "─".repeat(18) + "┐");
  });

  test("renders ┬ connector in bottom border", () => {
    const out = renderDiagram(input);
    expect(out).toContain("┬");
    // The full bottom border pattern for complex mode
    expect(out).toContain("└" + "─".repeat(8) + "┬" + "─".repeat(9) + "┘");
  });

  test("renders downward arrow after ┬ connector", () => {
    const out = renderDiagram(input);
    expect(out).toContain("▼");
  });

  test("renders internal item labels", () => {
    const out = renderDiagram(input);
    expect(out).toContain("FileSystem");
    expect(out).toContain("Cache");
  });

  test("renders 'Internal' label at the bottom", () => {
    const out = renderDiagram(input);
    const lines = out.split("\n");
    const last = lines[lines.length - 1];
    expect(last.trim()).toBe("Internal");
  });

  test("renders inbound arrows", () => {
    const out = renderDiagram(input);
    expect(out).toContain("──────────►");
  });

  test("renders outbound arrows", () => {
    const out = renderDiagram(input);
    expect(out).toContain("◄──────────");
  });

  test("renders app name inside box", () => {
    const out = renderDiagram(input);
    expect(out).toContain("MyApp");
  });
});

// ── Dispatching ────────────────────────────────────────────────────────────────

describe("renderDiagram dispatching", () => {
  test("dispatches to simple when internal is undefined", () => {
    const out = renderDiagram({ app: "A", inbound: ["x"], outbound: ["y"] });
    // Simple: single External, no ┬
    expect((out.split("\n")[0].match(/External/g) ?? []).length).toBe(1);
    expect(out).not.toContain("┬");
  });

  test("dispatches to simple when internal is empty array", () => {
    const out = renderDiagram({ app: "A", inbound: ["x"], outbound: ["y"], internal: [] });
    expect(out).not.toContain("┬");
  });

  test("dispatches to complex when internal has items", () => {
    const out = renderDiagram({ app: "A", inbound: ["x"], outbound: ["y"], internal: ["z"] });
    expect(out).toContain("┬");
    expect(out).toContain("z");
  });
});

// ── Asymmetric lists ───────────────────────────────────────────────────────────

describe("renderDiagram (asymmetric lists)", () => {
  test("more inbound than outbound: all inbound labels appear", () => {
    const out = renderDiagram({
      app: "App",
      inbound: ["A", "B", "C"],
      outbound: ["X"],
    });
    expect(out).toContain("A");
    expect(out).toContain("B");
    expect(out).toContain("C");
    expect(out).toContain("X");
  });

  test("more inbound than outbound: rows without outbound have no ◄──── arrow", () => {
    const out = renderDiagram({
      app: "App",
      inbound: ["A", "B", "C"],
      outbound: ["X"],
    });
    const lines = out.split("\n");
    // Count outbound arrow occurrences — should match outbound.length (1)
    const outboundArrows = lines.filter((l) => l.includes("◄──────────")).length;
    expect(outboundArrows).toBe(1);
  });

  test("more outbound than inbound: all outbound labels appear", () => {
    const out = renderDiagram({
      app: "App",
      inbound: ["X"],
      outbound: ["A", "B", "C"],
    });
    expect(out).toContain("A");
    expect(out).toContain("B");
    expect(out).toContain("C");
    expect(out).toContain("X");
  });

  test("more outbound than inbound: rows without inbound have no ──────────► arrow", () => {
    const out = renderDiagram({
      app: "App",
      inbound: ["X"],
      outbound: ["A", "B", "C"],
    });
    const lines = out.split("\n");
    const inboundArrows = lines.filter((l) => l.includes("──────────►")).length;
    expect(inboundArrows).toBe(1);
  });
});

// ── App name word-splitting ────────────────────────────────────────────────────

describe("renderDiagram (app name word-splitting)", () => {
  test("multi-word app name splits across interior lines", () => {
    const out = renderDiagram({
      app: "My Probe App",
      inbound: ["A", "B", "C"],
      outbound: ["X", "Y", "Z"],
    });
    // All words should appear somewhere in the output
    expect(out).toContain("My");
    expect(out).toContain("Probe");
    expect(out).toContain("App");
  });

  test("long single word is truncated to 14 characters inside box", () => {
    const longWord = "AVERYLONGAPPNAME"; // 16 chars, should be cut to 14
    const out = renderDiagram({
      app: longWord,
      inbound: ["A"],
      outbound: ["B"],
    });
    // The truncated portion (first 14 chars) should be inside the box
    expect(out).toContain("AVERYLONGAPPNA");
    // The 15th+ chars should NOT appear
    expect(out).not.toContain("AVERYLONGAPPNAM");
  });
});

// ── Single item each side ─────────────────────────────────────────────────────

describe("renderDiagram (single item each side)", () => {
  test("single inbound and outbound both appear", () => {
    const out = renderDiagram({
      app: "Core",
      inbound: ["HTTP"],
      outbound: ["DB"],
    });
    expect(out).toContain("HTTP");
    expect(out).toContain("DB");
    expect(out).toContain("──────────►");
    expect(out).toContain("◄──────────");
  });

  test("exactly one data row between box borders", () => {
    const out = renderDiagram({
      app: "Core",
      inbound: ["HTTP"],
      outbound: ["DB"],
    });
    const lines = out.split("\n");
    const topIdx = lines.findIndex((l) => l.includes("┌" + "─".repeat(18) + "┐"));
    const botIdx = lines.findIndex((l) => l.includes("└"));
    // There should be exactly 1 row between top and bottom borders
    expect(botIdx - topIdx).toBe(2);
  });
});
