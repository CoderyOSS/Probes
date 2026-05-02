import type { Socket } from "node:net";
import type { HandshakeModule } from "./index.js";

function buildBsonResponse(): Buffer {
  const elements: Buffer[] = [];

  const okVal = Buffer.alloc(8);
  okVal.writeDoubleLE(1.0, 0);
  elements.push(Buffer.concat([Buffer.from([0x01]), Buffer.from("ok\x00"), okVal]));

  elements.push(Buffer.concat([Buffer.from([0x08]), Buffer.from("ismaster\x00"), Buffer.from([0x01])]));

  const maxWire = Buffer.alloc(4);
  maxWire.writeInt32LE(17, 0);
  elements.push(Buffer.concat([Buffer.from([0x10]), Buffer.from("maxWireVersion\x00"), maxWire]));

  const minWire = Buffer.alloc(4);
  minWire.writeInt32LE(0, 0);
  elements.push(Buffer.concat([Buffer.from([0x10]), Buffer.from("minWireVersion\x00"), minWire]));

  const maxBson = Buffer.alloc(4);
  maxBson.writeInt32LE(16777216, 0);
  elements.push(Buffer.concat([Buffer.from([0x10]), Buffer.from("maxBsonObjectSize\x00"), maxBson]));

  const body = Buffer.concat(elements);
  const length = Buffer.alloc(4);
  length.writeInt32LE(body.length + 5, 0);
  return Buffer.concat([length, body, Buffer.from([0x00])]);
}

function buildOpMsgResponse(requestId: number): Buffer {
  const bsonDoc = buildBsonResponse();
  const sectionBsonLen = Buffer.alloc(4);
  sectionBsonLen.writeInt32LE(bsonDoc.length, 0);
  const section = Buffer.concat([Buffer.from([0x00]), sectionBsonLen, bsonDoc]);
  const flags = Buffer.alloc(4);
  const opMsgBody = Buffer.concat([flags, section]);

  const header = Buffer.alloc(16);
  header.writeInt32LE(16 + opMsgBody.length, 0);
  header.writeInt32LE(1, 4);
  header.writeInt32LE(requestId, 8);
  header.writeInt32LE(2013, 12);

  return Buffer.concat([header, opMsgBody]);
}

const mongodbHandshake: HandshakeModule = {
  name: "mongodb",
  async handle(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.removeListener("data", onData);
        reject(new Error("MongoDB handshake timeout"));
      }, 5000);

      function onData(data: Buffer) {
        if (data.length < 16) return;

        const opCode = data.readInt32LE(12);
        const requestId = data.readInt32LE(4);

        if (opCode === 2013 || opCode === 2004 || opCode === 2010 || opCode === 2011) {
          const response = buildOpMsgResponse(requestId);
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

export default mongodbHandshake;
