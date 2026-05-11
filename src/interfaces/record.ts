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

      const title = config.title ?? "E2E Proof Records";
      let md = `# ${title}\n\n`;
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
        md += ` | **Duration:** ${entry.duration_ms}ms\n\n`;

        const sorted = [...entry.events].sort((a, b) => a.time.localeCompare(b.time));

        if (sorted.length > 0) {
          md += `### Sequence\n\n`;
          md += `| # | Time | Direction | Step | Detail |\n`;
          md += `|---|------|-----------|------|--------|\n`;
          for (let i = 0; i < sorted.length; i++) {
            const e = sorted[i];
            md += `| ${i + 1} | ${shortTime(e.time)} | ${eventDirection(e)} | ${eventStep(e)} | \`${eventDetail(e)}\` |\n`;
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

function eventStep(e: RecordEvent): string {
  switch (e.kind) {
    case "send":
      return `${e.interface}.${e.action}`;
    case "recv":
      return e.source;
    case "response":
      return `${e.interface} response`;
  }
}

function eventDirection(e: RecordEvent): string {
  switch (e.kind) {
    case "send":
      if (e.interface === "http" && e.action === "put") return "Setup";
      return "Send";
    case "recv":
      return "Recv";
    case "response":
      return "Response";
  }
}

function eventDetail(e: RecordEvent): string {
  switch (e.kind) {
    case "send": {
      const dataStr = e.data ?? "";
      return truncate(dataStr, 200);
    }
    case "recv": {
      const dataStr = typeof e.data === "string" ? e.data : JSON.stringify(e.data);
      return truncate(dataStr, 300);
    }
    case "response": {
      const raw = e.parsed ? JSON.stringify(e.parsed) : sanitize(e.raw ?? "");
      return truncate(raw, 300);
    }
  }
}

function sanitize(s: string): string {
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

function truncate(s: string, max: number): string {
  const collapsed = s.replace(/\n/g, " ").replace(/\s+/g, " ");
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 3) + "...";
}
