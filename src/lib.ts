import { validateConfig, loadConfig } from "./config";
import { createSqlInterface, type SqlActions } from "./interfaces/sql";
import { createHttpInterface, type HttpActions } from "./interfaces/http";
import { createFsInterface, type FsActions } from "./interfaces/fs";
import { createTcpInterface, type TcpActions } from "./interfaces/tcp";
import type { ProbesConfig, ProbesInstance } from "./interfaces/types";

class ProbesInstanceImpl implements ProbesInstance {
  private config: ProbesConfig;
  private sqlImpl?: SqlActions & { close: () => void };
  private httpImpl?: HttpActions & { close: () => void };
  private fsImpl?: FsActions & { close: () => void };
  private tcpImpl?: TcpActions;

  constructor(config: ProbesConfig) {
    this.config = config;
  }

  async init() {
    if (this.config.sql) {
      this.sqlImpl = createSqlInterface(this.config.sql);
    }
    if (this.config.http) {
      this.httpImpl = createHttpInterface(this.config.http);
    }
    if (this.config.fs) {
      this.fsImpl = createFsInterface(this.config.fs);
    }
    if (this.config.tcp) {
      this.tcpImpl = createTcpInterface(this.config.tcp.tcp);
    }

    if (!this.sqlImpl && !this.httpImpl && !this.fsImpl && !this.tcpImpl) {
      throw new Error("At least one interface must be configured (http, sql, fs, or tcp)");
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
    };
  }

  get sql(): ProbesInstance["sql"] {
    if (!this.sqlImpl) throw new Error("SQL interface not configured");
    return {
      put: (p) => this.sqlImpl!.put(p),
      read: (p) => this.sqlImpl!.read(p),
      reset: (p) => this.sqlImpl!.reset(p),
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

  async configure(partial: Partial<ProbesConfig>): Promise<ProbesConfig> {
    const merged: ProbesConfig = {
      ...this.config,
      ...partial,
      http: this.config.http || partial.http ? { ...this.config.http, ...partial.http } as ProbesConfig["http"] : undefined,
      sql: this.config.sql || partial.sql ? { ...this.config.sql, ...partial.sql } as ProbesConfig["sql"] : undefined,
      fs: this.config.fs || partial.fs ? { ...this.config.fs, ...partial.fs } as ProbesConfig["fs"] : undefined,
    };

    const validated = validateConfig(merged);

    if (partial.sql) {
      this.sqlImpl?.close();
      this.sqlImpl = createSqlInterface(validated.sql!);
    }
    if (partial.http) {
      this.httpImpl?.close();
      this.httpImpl = createHttpInterface(validated.http!);
    }
    if (partial.fs) {
      this.fsImpl?.close();
      this.fsImpl = createFsInterface(validated.fs!);
    }
    if (partial.tcp) {
      this.tcpImpl?.close();
      this.tcpImpl = createTcpInterface(validated.tcp!.tcp);
    }

    this.config = validated;
    return { ...validated };
  }

  async close() {
    this.sqlImpl?.close();
    this.httpImpl?.close();
    this.fsImpl?.close();
    this.tcpImpl?.close();
  }
}

export async function probes(config: Partial<ProbesConfig>): Promise<ProbesInstance> {
  const validated = validateConfig(config);
  const instance = new ProbesInstanceImpl(validated);
  await instance.init();
  return instance;
}

export { loadConfig } from "./config";
export type { ProbesConfig, ProbesInstance } from "./interfaces/types";
