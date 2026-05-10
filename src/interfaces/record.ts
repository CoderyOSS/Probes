import type { RecordConfig, RecordEvent, ProofEntry } from "./types";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface RecordBuffer {
  push(event: RecordEvent): void;
}

export interface RecordActions {
  begin: (params: { test_name: string }) => void;
  end: (params: { result: "pass" | "fail"; error?: string }) => void;
  write: () => Promise<void>;
  close: () => void;
  buffer: RecordBuffer;
}

export function createRecordInterface(config: RecordConfig): RecordActions {
  const entries: ProofEntry[] = [];
  let current: ProofEntry | null = null;
  let suiteStartTime = Date.now();

  const buffer: RecordBuffer = {
    push(event) {
      if (!current) return;
      current.events.push(event);
    },
  };

  return {
    buffer,
    begin({ test_name }) {
      current = {
        test_name,
        started_at: new Date().toISOString(),
        duration_ms: 0,
        result: "pass",
        events: [],
      };
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
        if (entry.error) {
          md += ` | **Error:** ${truncate(entry.error, 200)}`;
        }
        md += ` | **Started:** ${entry.started_at}`;
        md += ` | **Duration:** ${entry.duration_ms}ms\n\n`;

        const sends = entry.events.filter((e) => e.kind === "send");
        const responses = entry.events.filter((e) => e.kind === "response");
        const recvs = entry.events.filter((e) => e.kind === "recv");

        if (sends.length > 0) {
          md += `### Send\n\n`;
          md += `| # | Time | Interface | Action | Path | Data |\n`;
          md += `|---|------|-----------|--------|------|------|\n`;
          for (let i = 0; i < sends.length; i++) {
            const s = sends[i];
            if (s.kind !== "send") continue;
            md += `| ${i + 1} | ${shortTime(s.time)} | ${s.interface} | ${s.action} | ${s.path ?? "-"} | \`${truncate(s.data ?? "", 200)}\` |\n`;
          }
          md += `\n`;
        }

        if (recvs.length > 0) {
          md += `### Recv\n\n`;
          md += `| # | Time | Source | Data |\n`;
          md += `|---|------|--------|------|\n`;
          for (let i = 0; i < recvs.length; i++) {
            const r = recvs[i];
            if (r.kind !== "recv") continue;
            const dataStr = truncate(typeof r.data === "string" ? r.data : JSON.stringify(r.data), 300);
            md += `| ${i + 1} | ${shortTime(r.time)} | ${r.source} | \`${dataStr}\` |\n`;
          }
          md += `\n`;
        }

        if (responses.length > 0) {
          md += `### Response\n\n`;
          md += `| # | Time | Interface | Data |\n`;
          md += `|---|------|-----------|------|\n`;
          for (let i = 0; i < responses.length; i++) {
            const r = responses[i];
            if (r.kind !== "response") continue;
            const dataStr = truncate(
              r.parsed ? JSON.stringify(r.parsed) : (r.raw ?? ""),
              300
            );
            md += `| ${i + 1} | ${shortTime(r.time)} | ${r.interface} | \`${dataStr}\` |\n`;
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
    return iso.split("T")[1]?.replace("Z", "") ?? iso;
  } catch {
    return iso;
  }
}

function truncate(s: string, max: number): string {
  const collapsed = s.replace(/\n/g, " ").replace(/\s+/g, " ");
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 3) + "...";
}
