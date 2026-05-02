import type { Socket } from "node:net";
import type { HandshakeModule } from "./index.js";

function parseRespCommand(data: Buffer): string[] {
  const str = data.toString("utf8");
  if (!str.startsWith("*")) return [];
  const lines = str.split("\r\n");
  const commands: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("$")) {
      const nextLine = lines[i + 1];
      if (nextLine) {
        commands.push(nextLine.toUpperCase());
        i++;
      }
    }
  }
  return commands;
}

const redisHandshake: HandshakeModule = {
  name: "redis",
  async handle(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.removeListener("data", onData);
        reject(new Error("Redis handshake timeout"));
      }, 5000);

      let resolved = false;

      function onData(data: Buffer) {
        if (resolved) return;
        const commands = parseRespCommand(data);
        const cmd = commands[0];
        if (
          cmd === "PING" ||
          cmd === "AUTH" ||
          cmd === "CLIENT" ||
          cmd === "CONFIG" ||
          cmd === "INFO" ||
          cmd === "COMMAND"
        ) {
          const response =
            cmd === "PING" ? "+PONG\r\n" : "+OK\r\n";
          socket.write(Buffer.from(response));
          resolved = true;
          clearTimeout(timeout);
          socket.removeListener("data", onData);
          resolve();
        }
      }

      socket.on("data", onData);
    });
  },
};

export default redisHandshake;
