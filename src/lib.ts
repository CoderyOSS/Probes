import { validateConfig, loadConfig, findConfigFile } from "./config";
import { createSqlInterface, type SqlActions } from "./interfaces/sql";
import { createHttpInterface, type HttpActions } from "./interfaces/http";
import { createFsInterface, type FsActions } from "./interfaces/fs";
import { createTcpInterface, type TcpActions } from "./interfaces/tcp";
import { createWsServerInterface, type WsServerActions } from "./interfaces/ws_server";
import { createWsClientInterface, type WsClientActions } from "./interfaces/ws_client";
import { createUnixInterface, type UnixActions } from "./interfaces/unix";
import { createRecordInterface, type RecordActions, type RecordBuffer } from "./interfaces/record";
import { spawn } from "bun";
import type { ProbesConfig, ProbesInstance } from "./interfaces/types";
import { statSync } from "node:fs";
import { dirname } from "node:path";

let _instance: ProbesInstanceImpl | null = null;
let _initPromise: Promise<void> | null = null;
let _launcherProc: { kill: () => void } | null = null;

class ProbesInstanceImpl implements ProbesInstance {
  private config: ProbesConfig;
  private sqlImpl?: SqlActions & { close: () => void };
  private httpImpl?: (HttpActions & { close: () => void }) & { use: <In, Out>(adapter: Partial<ProbesInstance["http"]>) => ProbesInstance["http"] };
  private fsImpl?: FsActions & { close: () => void };
  private tcpImpl?: TcpActions;
  private wsServerImpl?: WsServerActions;
  private wsClientImpl?: WsClientActions;
  private unixImpl?: UnixActions & { use: <In, Out>(adapter: Partial<UnixActions<In, Out>>) => UnixActions<In, Out> };
  private proofImpl?: RecordActions;
  private closed = false;

  constructor(config: ProbesConfig) {
    this.config = config;
  }

  async init() {
    this.proofImpl = createRecordInterface(this.config.proof);
    const recordBuf = this.proofImpl.buffer;

    const ifaces = this.config.interfaces;
    if (ifaces) {
      if (ifaces.sql) {
        this.sqlImpl = createSqlInterface(ifaces.sql, recordBuf);
      }
      if (ifaces.http) {
        this.httpImpl = createHttpInterface(ifaces.http, recordBuf) as any;
      }
      if (ifaces.fs) {
        this.fsImpl = createFsInterface(ifaces.fs, recordBuf);
      }
      if (ifaces.tcp) {
        this.tcpImpl = createTcpInterface(ifaces.tcp, recordBuf);
      }
      if (ifaces.ws?.server) {
        this.wsServerImpl = createWsServerInterface(ifaces.ws.server, recordBuf);
      }
      if (ifaces.ws?.client) {
        this.wsClientImpl = await createWsClientInterface(ifaces.ws.client, recordBuf);
      }
      if (ifaces.unix) {
        this.unixImpl = createUnixInterface(ifaces.unix, recordBuf) as any;
      }
    }
  }

  get http(): ProbesInstance["http"] {
    if (!this.httpImpl) throw new Error("HTTP interface not configured");
    return {
      send: (p) => this.httpImpl!.send(p),
      put: (p) => this.httpImpl!.put(p),
      read: () => this.httpImpl!.read(),
      watch: (p) => this.httpImpl!.watch(p),
      reset: () => this.httpImpl!.reset(),
      use: (adapter) => this.httpImpl!.use(adapter),
    };
  }

  get sql(): ProbesInstance["sql"] {
    if (!this.sqlImpl) throw new Error("SQL interface not configured");
    return {
      put: (p) => this.sqlImpl!.put(p),
      read: (p) => this.sqlImpl!.read(p),
      clear: (p) => this.sqlImpl!.clear(p),
    };
  }

  get fs(): ProbesInstance["fs"] {
    if (!this.fsImpl) throw new Error("FS interface not configured");
    return {
      put: (p) => this.fsImpl!.put(p),
      read: (p) => this.fsImpl!.read(p),
      watch: (p) => this.fsImpl!.watch(p),
      reset: (p) => this.fsImpl!.reset(p),
    };
  }

  get tcp(): ProbesInstance["tcp"] {
    if (!this.tcpImpl) throw new Error("TCP interface not configured");
    return {
      send: (p) => this.tcpImpl!.send(p),
      watch: (p) => this.tcpImpl!.watch(p),
    };
  }

  get ws(): ProbesInstance["ws"] {
    if (!this.wsServerImpl && !this.wsClientImpl) throw new Error("WS interface not configured");
    return {
      client: this.wsClientImpl ? {
        send: (p) => this.wsClientImpl!.send(p),
        watch: (p) => this.wsClientImpl!.watch(p),
        reset: (p) => this.wsClientImpl!.reset(p),
      } : undefined,
      server: this.wsServerImpl ? {
        send: (p) => this.wsServerImpl!.send(p),
        watch: (p) => this.wsServerImpl!.watch(p),
        reset: (p) => this.wsServerImpl!.reset(p),
      } : undefined,
    };
  }

  get unix(): ProbesInstance["unix"] {
    if (!this.unixImpl) throw new Error("Unix interface not configured");
    return {
      send: (p) => this.unixImpl!.send(p),
      send_json: (p) => this.unixImpl!.send_json(p),
      watch: (p) => this.unixImpl!.watch(p),
      use: (factory) => this.unixImpl!.use(factory),
    };
  }

  get proof(): ProbesInstance["proof"] {
    if (!this.proofImpl) throw new Error("Proof not initialized");
    return {
      begin: (name) => this.proofImpl!.begin(name),
      end: () => this.proofImpl!.end(),
      save: () => this.proofImpl!.save(),
    };
  }

  async configure(partial: Partial<ProbesConfig>): Promise<ProbesConfig> {
    const merged: ProbesConfig = {
      ...this.config,
      ...partial,
      proof: { ...this.config.proof, ...partial.proof } as ProbesConfig["proof"],
      interfaces: {
        ...this.config.interfaces,
        ...partial.interfaces,
      } as ProbesConfig["interfaces"],
    };

    const validated = validateConfig(merged);
    const recordBuf = this.proofImpl?.buffer;

    const ifaces = validated.interfaces;
    if (partial.interfaces?.sql) {
      this.sqlImpl?.close();
      this.sqlImpl = createSqlInterface(ifaces!.sql!, recordBuf);
    }
    if (partial.interfaces?.http) {
      this.httpImpl?.close();
      this.httpImpl = createHttpInterface(ifaces!.http!, recordBuf) as any;
    }
    if (partial.interfaces?.fs) {
      this.fsImpl?.close();
      this.fsImpl = createFsInterface(ifaces!.fs!, recordBuf);
    }
    if (partial.interfaces?.tcp) {
      this.tcpImpl?.close();
      this.tcpImpl = createTcpInterface(ifaces!.tcp!, recordBuf);
    }
    if (partial.interfaces?.ws?.server) {
      this.wsServerImpl?.close();
      this.wsServerImpl = createWsServerInterface(ifaces!.ws!.server!, recordBuf);
    }
    if (partial.interfaces?.ws?.client) {
      this.wsClientImpl?.close();
      this.wsClientImpl = await createWsClientInterface(ifaces!.ws!.client!, recordBuf);
    }
    if (partial.interfaces?.unix) {
      this.unixImpl?.close();
      this.unixImpl = createUnixInterface(ifaces!.unix!, recordBuf) as any;
    }

    this.config = validated;
    return { ...validated };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.sqlImpl?.close();
    this.httpImpl?.close();
    this.fsImpl?.close();
    this.tcpImpl?.close();
    this.wsServerImpl?.close();
    this.wsClientImpl?.close();
    this.unixImpl?.close();
    this.sqlImpl = undefined;
    this.httpImpl = undefined;
    this.fsImpl = undefined;
    this.tcpImpl = undefined;
    this.wsServerImpl = undefined;
    this.wsClientImpl = undefined;
    this.unixImpl = undefined;
    this.proofImpl = undefined;
  }
}

async function pollSocket(path: string, intervalMs: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const st = statSync(path);
      if (st.isSocket()) return;
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Ready socket ${path} not available after ${timeoutMs}ms`);
}

async function autoInit(): Promise<void> {
  const configPath = findConfigFile(process.cwd());
  if (!configPath) return;

  let config: ProbesConfig;
  try {
    config = loadConfig(configPath);
  } catch (e) {
    console.warn(`probes: failed to load ${configPath}: ${(e as Error).message}`);
    return;
  }

  const configDir = dirname(configPath);

  if (config.launcher) {
    const shellCmd = config.launcher.command;
    _launcherProc = spawn({ cmd: ["sh", "-c", shellCmd], cwd: configDir, stdout: "ignore", stderr: "ignore" });
  }

  if (config.launcher?.ready_socket) {
    await pollSocket(
      config.launcher.ready_socket,
      config.launcher.poll_interval_ms ?? 50,
      config.launcher.poll_timeout_ms ?? 10000,
    );
  } else if (config.launcher?.ready_after_ms) {
    await new Promise((r) => setTimeout(r, config.launcher.ready_after_ms));
  }

  const instance = new ProbesInstanceImpl(config);
  await instance.init();
  _instance = instance;

  const saveAndCleanup = () => {
    if (_instance) {
      _instance.proof.save();
    }
    if (_launcherProc) {
      try { _launcherProc.kill(); } catch {}
    }
  };
  process.on("exit", saveAndCleanup);
  process.on("beforeExit", saveAndCleanup);
}

export function probesSession(config: ProbesConfig): Promise<ProbesInstance> {
  return Promise.resolve(initManual(config));
}

async function initManual(config: ProbesConfig): Promise<ProbesInstance> {
  const instance = new ProbesInstanceImpl(config);
  await instance.init();
  _instance = instance;
  const save = () => {
    if (_instance) _instance.proof.save();
  };
  process.on("exit", save);
  process.on("beforeExit", save);
  return instance;
}

/**
 * Global lazy proxy — auto-inits from probes.yml, auto-saves proof records.
 * Use this in all test files: `import { p } from "@codery/probes"`
 */
export const p: ProbesInstance = new Proxy({} as ProbesInstance, {
  get(_target, key) {
    if (!_instance) {
      throw new Error(
        "probes: no session active. Ensure probes.yml is in a parent directory " +
        "and the test runner imports probes before running tests."
      );
    }
    return (_instance as any)[key];
  },
});

if (typeof Bun !== "undefined" && !process.env.PROBES_SKIP_AUTOINIT) {
  await autoInit();
}

export { loadConfig, findConfigFile } from "./config";
export type { ProbesConfig, ProbesInstance } from "./interfaces/types";

/**
 * Creates an isolated ProbesInstance WITHOUT auto-save.
 * For standalone scripts only — you MUST call `.proof.save()` manually.
 * For test suites, use the `p` export instead.
 */
export async function probes(config: Partial<ProbesConfig>): Promise<ProbesInstance> {
  const validated = validateConfig(config);
  const instance = new ProbesInstanceImpl(validated);
  await instance.init();
  return instance;
}

export function group(config: Partial<ProbesConfig>): ProbesGroup {
  const validated = validateConfig(config);
  let instance: ProbesInstanceImpl | null = null;
  let consumers = 0;
  let closed = false;
  const teardownHooks: (() => Promise<void>)[] = [];

  return {
    async attach() {
      if (closed) {
        instance = new ProbesInstanceImpl(validated);
        await instance.init();
        closed = false;
      }
      if (!instance) {
        instance = new ProbesInstanceImpl(validated);
        await instance.init();
      }
      consumers++;
      return instance;
    },

    async detach() {
      consumers = Math.max(0, consumers - 1);
      if (consumers > 0) return;

      for (const hook of teardownHooks) {
        try { await hook(); } catch (e) { console.error("probes group teardown hook failed:", e); }
      }
      teardownHooks.length = 0;

      if (instance) {
        await instance.close();
        instance = null;
      }
      closed = true;
    },

    onTeardown(fn: () => Promise<void>) {
      teardownHooks.push(fn);
    },
  };
}

export interface ProbesGroup {
  attach(): Promise<ProbesInstance>;
  detach(): Promise<void>;
  onTeardown(fn: () => Promise<void>): void;
}
