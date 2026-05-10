import type { RecordConfig, RecordCall, RecordResponse, RecordAssertion, ProofEntry } from "./types";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface RecordActions {
  begin: (params: { test_name: string }) => void;
  call: (params: { interface: string; action: string; path?: string; data?: string }) => void;
  response: (params: { data: unknown }) => void;
  assert: (params: { expect: string; expected: string; actual: string; pass: boolean }) => void;
  end: (params: { result: "pass" | "fail"; error?: string }) => void;
  write: () => Promise<void>;
  close: () => void;
}

export function createRecordInterface(config: RecordConfig): RecordActions {
  const entries: ProofEntry[] = [];
  let current: ProofEntry | null = null;
  let suiteStartTime = Date.now();

  return {
    begin({ test_name }) {
      current = {
        test_name,
        started_at: new Date().toISOString(),
        duration_ms: 0,
        result: "pass",
        calls: [],
        responses: [],
        assertions: [],
      };
    },

    call({ interface: iface, action, path, data }) {
      if (!current) return;
      current.calls.push({
        time: new Date().toISOString(),
        interface: iface,
        action,
        path,
        data,
      });
    },

    response({ data }) {
      if (!current) return;
      current.responses.push({
        time: new Date().toISOString(),
        data,
      });
    },

    assert({ expect, expected, actual, pass }) {
      if (!current) return;
      current.assertions.push({ expect, expected, actual, pass });
    },

    end({ result, error }) {
      if (!current) return;
      current.duration_ms = Date.now() - new Date(current.started_at).getTime();
      current.result = result;
      if (error) current.error = error;
      entries.push(current);
      current = null;
    },

    async write() {
      const totalDuration = Date.now() - suiteStartTime;
      const passes = entries.filter((e) => e.result === "pass").length;
      const fails = entries.filter((e) => e.result === "fail").length;

      let md = `# ShellGate E2E Proof Records\n\n`;
      md += `**Date:** ${new Date().toISOString()}\n`;
      md += `**Tests:** ${entries.length} run, ${passes} pass, ${fails} fail\n`;
      md += `**Duration:** ${totalDuration}ms\n\n`;
      md += `---\n\n`;

      for (const entry of entries) {
        const statusIcon = entry.result === "pass" ? "✓" : "✗";
        md += `## ${entry.test_name}\n\n`;
        md += `**Status:** ${statusIcon} ${entry.result}`;
        md += ` | **Started:** ${entry.started_at}`;
        md += ` | **Duration:** ${entry.duration_ms}ms\n`;
        if (entry.error) {
          md += `\n**Error:** ${truncate(entry.error, 500)}\n`;
        }
        md += `\n`;

        if (entry.calls.length > 0) {
          md += `### Probes calls\n\n`;
          md += `| # | Time | Interface | Action | Path | Data |\n`;
          md += `|---|------|-----------|--------|------|------|\n`;
          for (let i = 0; i < entry.calls.length; i++) {
            const c = entry.calls[i];
            md += `| ${i + 1} | ${shortTime(c.time)} | ${c.interface} | ${c.action} | ${c.path ?? "-"} | \`${truncate(c.data ?? "", 200)}\` |\n`;
          }
          md += `\n`;
        }

        if (entry.responses.length > 0) {
          md += `### Responses\n\n`;
          for (let i = 0; i < entry.responses.length; i++) {
            const r = entry.responses[i];
            const dataStr = truncate(typeof r.data === "string" ? r.data : JSON.stringify(r.data), 500);
            md += `| ${i + 1} | ${shortTime(r.time)} | \`${dataStr}\` |\n`;
          }
          md += `\n`;
        }

        if (entry.assertions.length > 0) {
          md += `### Assertions\n\n`;
          md += `| # | Expected | Actual | Pass |\n`;
          md += `|---|----------|--------|------|\n`;
          for (let i = 0; i < entry.assertions.length; i++) {
            const a = entry.assertions[i];
            md += `| ${i + 1} | ${truncate(a.expected, 100)} | ${truncate(a.actual, 100)} | ${a.pass ? "✓" : "✗"} |\n`;
          }
          md += `\n`;
        }

        md += `---\n\n`;
      }

      const dir = dirname(config.output_path);
      mkdirSync(dir, { recursive: true });
      writeFileSync(config.output_path, md);
      suiteStartTime = Date.now();
      entries.length = 0;
    },

    close() {
      current = null;
      entries.length = 0;
    },
  };
}

function shortTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().split("T")[1]?.replace("Z", "") ?? iso;
  } catch {
    return iso;
  }
}

function truncate(s: string, max: number): string {
  const collapsed = s.replace(/\n/g, " ").replace(/\s+/g, " ");
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 3) + "...";
}
