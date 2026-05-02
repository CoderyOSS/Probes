import type { Socket } from "node:net";
import type { HandshakeModule } from "./index.js";

function pgMessage(type: string, body: Buffer): Buffer {
  const typeByte = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeInt32BE(body.length + 4, 0);
  return Buffer.concat([typeByte, length, body]);
}

function authOk(): Buffer {
  const code = Buffer.alloc(4);
  code.writeInt32BE(0, 0);
  return pgMessage("R", code);
}

function parameterStatus(name: string, value: string): Buffer {
  const body = Buffer.from(`${name}\0${value}\0`);
  return pgMessage("S", body);
}

function backendKeyData(pid: number, secret: number): Buffer {
  const body = Buffer.alloc(8);
  body.writeInt32BE(pid, 0);
  body.writeInt32BE(secret, 4);
  return pgMessage("K", body);
}

function readyForQuery(): Buffer {
  return pgMessage("Z", Buffer.from("I", "ascii"));
}

const postgresqlHandshake: HandshakeModule = {
  name: "postgresql",
  async handle(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.removeListener("data", onData);
        reject(new Error("PostgreSQL handshake timeout"));
      }, 5000);

      function onData(data: Buffer) {
        if (data.length < 8) return;

        const protocol = data.readInt32BE(4);

        if (protocol === 80877103) {
          socket.write(Buffer.from("N"));
          return;
        }

        if (protocol === 196608) {
          const response = Buffer.concat([
            authOk(),
            parameterStatus("server_version", "15.0"),
            parameterStatus("client_encoding", "UTF8"),
            parameterStatus("DateStyle", "ISO, MDY"),
            backendKeyData(
              Math.floor(Math.random() * 10000),
              Math.floor(Math.random() * 10000)
            ),
            readyForQuery(),
          ]);
          socket.write(response);
          clearTimeout(timeout);
          socket.removeListener("data", onData);
          resolve();
        }
      }

      socket.on("data", onData);
    });
  },
};

export default postgresqlHandshake;
