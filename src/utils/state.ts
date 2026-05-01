import type { CapturedRequest } from "../interfaces/types";

export class RequestBuffer {
  private requests: CapturedRequest[] = [];

  push(req: CapturedRequest): void {
    this.requests.push(req);
  }

  drain(): CapturedRequest[] {
    const copy = [...this.requests];
    this.requests = [];
    return copy;
  }

  clear(): void {
    this.requests = [];
  }
}
