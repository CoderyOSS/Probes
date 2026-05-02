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

export interface CapturedTcpData {
  data: string;
  timestamp: number;
  remote: string;
}

export interface ProbesConfig {
  http?: HttpConfig;
  sql?: SqlConfig;
  fs?: FsConfig;
  tcp?: TcpConfig;
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
  configure: (partial: Partial<ProbesConfig>) => Promise<ProbesConfig>;
  close: () => Promise<void>;
}
