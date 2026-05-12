import type { ProofConfig, RecordEvent } from "./types";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface RecordBuffer {
  push(event: RecordEvent): void;
}

export interface RecordActions {
  begin: (name: string) => void;
  end: () => void;
  save: () => void;
  buffer: RecordBuffer;
}

type TaggedEvent = { event: RecordEvent; section: string | null };

export function createRecordInterface(config: ProofConfig): RecordActions {
  const events: TaggedEvent[] = [];
  let currentSection: string | null = null;
  const sessionStart = Date.now();

  const buffer: RecordBuffer = {
    push(event) {
      events.push({ event, section: currentSection });
    },
  };

  function begin(name: string) {
    currentSection = name;
  }

  function end() {
    currentSection = null;
  }

  function save() {
    const totalDuration = Date.now() - sessionStart;

    const title = config.title ?? "E2E Proof Records";
    let md = `# ${title}\n\n`;
    md += `**Date:** ${new Date().toISOString()}\n`;
    md += `**Events:** ${events.length}\n`;
    md += `**Duration:** ${totalDuration}ms\n\n`;
    md += `---\n\n`;

    if (events.length > 0) {
      const sorted = [...events].sort((a, b) => a.event.time.localeCompare(b.event.time));

      const hasSections = sorted.some((e) => e.section !== null);

      if (hasSections) {
        const sections = new Map<string, TaggedEvent[]>();
        for (const e of sorted) {
          const key = e.section ?? "(setup)";
          if (!sections.has(key)) sections.set(key, []);
          sections.get(key)!.push(e);
        }
        for (const [name, group] of sections) {
          md += `## ${name}\n\n`;
          md += `| # | Time | Direction | Step | Detail |\n`;
          md += `|---|------|-----------|------|--------|\n`;
          for (let i = 0; i < group.length; i++) {
            const e = group[i].event;
            md += `| ${i + 1} | ${shortTime(e.time)} | ${eventDirection(e)} | ${eventStep(e)} | \`${eventDetail(e)}\` |\n`;
          }
          md += `\n---\n\n`;
        }
      } else {
        md += `### Sequence\n\n`;
        md += `| # | Time | Direction | Step | Detail |\n`;
        md += `|---|------|-----------|------|--------|\n`;
        for (let i = 0; i < sorted.length; i++) {
          const e = sorted[i].event;
          md += `| ${i + 1} | ${shortTime(e.time)} | ${eventDirection(e)} | ${eventStep(e)} | \`${eventDetail(e)}\` |\n`;
        }
        md += `\n---\n\n`;
      }
    }

    const dir = dirname(config.output);
    mkdirSync(dir, { recursive: true });
    writeFileSync(config.output, md);
  }

  return { begin, end, save, buffer };
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
