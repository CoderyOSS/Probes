export interface HttpClientConfig {
  base_url: string;
  headers?: Record<string, string>;
  timeout_ms?: number;
}

export interface HttpServerConfig {
  port: number;
  idle_timeout_ms?: number;
}

export interface HttpConfig {
  client?: HttpClientConfig;
  server?: HttpServerConfig;
}

export interface SqlConfig {
  path: string;
  reset_on_start?: boolean;
}

export interface FsConfig {
  root: string;
  reset_on_start?: boolean;
}

export interface TcpTargetConfig {
  name: string;
  port: number;
  handshake?: string;
  idle_timeout_ms?: number;
}

export type TcpConfig = TcpTargetConfig[];

export interface WsServerTargetConfig {
  name: string;
  port: number;
  idle_timeout_ms?: number;
}

export type WsServerConfig = WsServerTargetConfig[];

export interface WsClientTargetConfig {
  name: string;
  url: string;
}

export type WsClientConfig = WsClientTargetConfig[];

export interface WsConfig {
  client?: WsClientConfig;
  server?: WsServerConfig;
}

export interface UnixClientConfig {
  path: string;
  timeout_ms?: number;
}

export interface UnixServerTargetConfig {
  name: string;
  path: string;
  idle_timeout_ms?: number;
}

export type UnixServerConfig = UnixServerTargetConfig[];

export interface UnixConfig {
  client?: UnixClientConfig;
  server?: UnixServerConfig;
}

export interface RecordCall {
  time: string;
  interface: string;
  action: string;
  path?: string;
  data?: string;
}

export type RecordEvent =
  | { kind: "send"; time: string; interface: string; action: string; path?: string; data?: string }
  | { kind: "response"; time: string; interface: string; raw?: string; parsed?: unknown }
  | { kind: "recv"; time: string; source: string; data: unknown };

export interface ProofEntry {
  test_name: string;
  started_at: string;
  duration_ms: number;
  result: "pass" | "fail";
  error?: string;
  events: RecordEvent[];
}

export interface RecordConfig {
  output_path: string;
}

export interface CapturedWsMessage {
  data: string;
  data_base64?: string;
  timestamp: number;
  remote: string;
  type: "text" | "binary";
}

export interface CapturedTcpData {
  data: string;
  timestamp: number;
  remote: string;
}

export interface CapturedUnixData {
  data: string;
  timestamp: number;
  peer_path?: string;
}

export interface ProbesConfig {
  http?: HttpConfig;
  sql?: SqlConfig;
  fs?: FsConfig;
  tcp?: TcpConfig;
  ws?: WsConfig;
  unix?: UnixConfig;
  record?: RecordConfig;
}

export interface CapturedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  timestamp: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface ProbesInstance {
  http: {
    send: (params: {
      method: string;
      path: string;
      headers?: Record<string, string>;
      body?: unknown;
    }) => Promise<HttpResponse>;
    put: (params: {
      status: number;
      headers?: Record<string, string>;
      body?: unknown;
    }) => Promise<void>;
    read: () => Promise<CapturedRequest[]>;
    watch: (params?: { timeout_ms?: number }) => Promise<CapturedRequest>;
    reset: () => Promise<void>;
  };
  sql: {
    put: (params: { table: string; rows: Record<string, unknown>[] }) => Promise<void>;
    read: (params: {
      table: string;
      where?: Record<string, unknown>;
      order_by?: string;
      limit?: number;
    }) => Promise<Record<string, unknown>[]>;
    reset: (params?: { table?: string }) => Promise<void>;
  };
  fs: {
    put: (params: { path: string; content: string }) => Promise<void>;
    read: (params: { path: string }) => Promise<string>;
    watch: (params: { path: string; timeout_ms?: number }) => Promise<string>;
    reset: (params?: { path?: string }) => Promise<void>;
  };
  tcp: {
    send: (params: { target: string; data: string }) => Promise<void>;
    watch: (params: { target: string; timeout_ms?: number }) => AsyncIterable<CapturedTcpData>;
  };
  ws: {
    client?: {
      send: (params: { target: string; data: string; binary?: boolean }) => Promise<void>;
      watch: (params: { target: string; timeout_ms?: number }) => AsyncIterable<CapturedWsMessage>;
      reset: (params: { target: string }) => Promise<void>;
    };
    server?: {
      send: (params: { target: string; data: string; binary?: boolean }) => Promise<void>;
      watch: (params: { target: string; timeout_ms?: number }) => AsyncIterable<CapturedWsMessage>;
      reset: (params: { target: string }) => Promise<void>;
    };
  };
  unix: {
    send: (params: { data: string; path?: string; timeout_ms?: number }) => Promise<string>;
    send_json: (params: { data: unknown; path?: string; timeout_ms?: number }) => Promise<unknown>;
    watch: (params: { target: string; timeout_ms?: number }) => AsyncIterable<CapturedUnixData>;
  };
  record: {
    begin: (params: { test_name: string }) => void;
    end: (params: { result: "pass" | "fail"; error?: string }) => void;
    write: () => Promise<void>;
  };
  configure: (partial: Partial<ProbesConfig>) => Promise<ProbesConfig>;
  close: () => Promise<void>;
}
