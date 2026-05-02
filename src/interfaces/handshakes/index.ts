import type { Socket } from "node:net";

export interface HandshakeModule {
  name: string;
  handle(socket: Socket): Promise<void>;
}

const registry = new Map<string, HandshakeModule>();

export function registerHandshake(module: HandshakeModule): void {
  registry.set(module.name, module);
}

export function resolveHandshake(name: string): HandshakeModule | null {
  return registry.get(name) ?? null;
}

export function getRegisteredHandshakes(): string[] {
  return [...registry.keys()];
}

import rawHandshake from "./raw.js";
registerHandshake(rawHandshake);
