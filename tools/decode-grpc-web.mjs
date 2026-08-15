#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

function readVarint(buffer, start) {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < buffer.length) {
    const byte = BigInt(buffer[offset]);
    value |= (byte & 0x7fn) << shift;
    offset += 1;
    if ((byte & 0x80n) === 0n) return { value, offset };
    shift += 7n;
    if (shift > 70n) throw new Error("Invalid protobuf varint");
  }
  throw new Error("Truncated protobuf varint");
}

function maybeUtf8(buffer) {
  const text = buffer.toString("utf8");
  if (Buffer.from(text, "utf8").equals(buffer) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    return text;
  }
  return null;
}

function enumTypeFor(messageName, fieldName) {
  if (messageName === "interaction.Activity" && fieldName === "reaction") return "interaction.Activity.ReactionType";
  if (messageName === "interaction.Activity" && fieldName === "followStatus") return "interaction.Activity.FollowStatus";
  return null;
}

function decodeMessage(buffer, schema, messages = {}, enums = {}, depth = 0) {
  const fieldsByNumber = new Map((schema?.fields || []).map((field) => [field.number, field]));
  const occurrences = new Map();
  const decoded = [];
  let offset = 0;

  while (offset < buffer.length) {
    const key = readVarint(buffer, offset);
    offset = key.offset;
    const number = Number(key.value >> 3n);
    const wireType = Number(key.value & 7n);
    const schemaField = fieldsByNumber.get(number);
    const occurrence = (occurrences.get(number) || 0) + 1;
    occurrences.set(number, occurrence);
    const field = {
      number,
      name: schemaField?.name || `field${number}`,
      schemaType: schemaField?.type || null,
      repeated: schemaField?.repeated || occurrence > 1,
      wireType,
    };

    if (wireType === 0) {
      const value = readVarint(buffer, offset);
      offset = value.offset;
      field.value = value.value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value.value)
        : value.value.toString();
      if (schemaField?.type === "Bool") field.boolean = value.value !== 0n;
      const enumType = enumTypeFor(schema?.fullName, schemaField?.name);
      if (enumType) {
        field.enumType = enumType;
        field.enumName = Object.entries(enums[enumType] || {}).find(([, number]) => BigInt(number) === value.value)?.[0] || "UNKNOWN";
      }
    } else if (wireType === 1) {
      if (offset + 8 > buffer.length) throw new Error(`Truncated fixed64 field ${number}`);
      field.hex = buffer.subarray(offset, offset + 8).toString("hex");
      offset += 8;
    } else if (wireType === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const end = offset + Number(length.value);
      if (end > buffer.length) throw new Error(`Truncated length-delimited field ${number}`);
      const value = buffer.subarray(offset, end);
      offset = end;
      field.length = value.length;
      field.base64 = value.toString("base64");
      const nestedSchema = schemaField?.resolvedType ? messages[schemaField.resolvedType] : null;
      if (nestedSchema && depth < 12) {
        field.messageType = schemaField.resolvedType;
        field.fields = decodeMessage(value, nestedSchema, messages, enums, depth + 1);
      } else {
        field.text = maybeUtf8(value);
        if (schemaField?.typeCandidates) field.typeCandidates = schemaField.typeCandidates;
      }
    } else if (wireType === 5) {
      if (offset + 4 > buffer.length) throw new Error(`Truncated fixed32 field ${number}`);
      field.hex = buffer.subarray(offset, offset + 4).toString("hex");
      offset += 4;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wireType} at field ${number}`);
    }
    decoded.push(field);
  }
  return decoded;
}

function decodeBase64Stream(text) {
  const normalized = text.replace(/\s+/g, "");
  if (!normalized) return Buffer.alloc(0);

  // Some gRPC-Web implementations base64 each frame separately, leaving
  // padding in the middle; others encode the whole frame stream once.
  const chunks = normalized.match(/(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)/g);
  if (chunks?.length > 1 && chunks.join("") === normalized) {
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, "base64")));
  }
  return Buffer.from(normalized, "base64");
}

function decodeFrames(buffer, messageSchema, messages, enums) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 5 > buffer.length) throw new Error("Truncated gRPC-Web frame header");
    const flags = buffer[offset];
    const length = buffer.readUInt32BE(offset + 1);
    const start = offset + 5;
    const end = start + length;
    if (end > buffer.length) throw new Error(`Truncated gRPC-Web frame payload: wanted ${length} bytes`);
    const payload = buffer.subarray(start, end);
    const trailer = (flags & 0x80) !== 0;
    frames.push({
      flags,
      length,
      trailer,
      compressed: !trailer && (flags & 0x01) !== 0,
      ...(trailer
        ? { headers: Object.fromEntries(payload.toString("utf8").trim().split("\r\n").filter(Boolean).map((line) => {
            const separator = line.indexOf(":");
            return [line.slice(0, separator), line.slice(separator + 1)];
          })) }
        : { fields: decodeMessage(payload, messageSchema, messages, enums) }),
    });
    offset = end;
  }
  return frames;
}

function parseArguments(argv) {
  const options = { direction: "request" };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--schema") options.schemaPath = argv[++index];
    else if (argument === "--service") options.service = argv[++index];
    else if (argument === "--method") options.method = argv[++index];
    else if (argument === "--direction") options.direction = argv[++index];
    else positional.push(argument);
  }
  options.input = positional[0];
  return options;
}

async function readInput(input) {
  if (!input || input === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }
  if (input.startsWith("@")) return readFile(input.slice(1), "utf8");
  return input;
}

const options = parseArguments(process.argv.slice(2));
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = options.schemaPath || path.join(scriptDirectory, "..", "docs", "vsco-grpc-schema.json");
let messageSchema = null;
let messages = {};
let enums = {};
if (options.service && options.method) {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const method = schema.services?.[options.service]?.methods?.find((candidate) => candidate.method === options.method);
  if (!method) throw new Error(`Unknown schema method: ${options.service}/${options.method}`);
  if (!new Set(["request", "response"]).has(options.direction)) throw new Error("--direction must be request or response");
  messageSchema = method[options.direction];
  messages = schema.messages || {};
  enums = schema.enums || {};
}

const input = await readInput(options.input);
const wire = decodeBase64Stream(input);
const result = {
  encodedCharacters: input.replace(/\s+/g, "").length,
  wireBytes: wire.length,
  schema: messageSchema ? `${options.service}/${options.method}:${options.direction}` : null,
  frames: decodeFrames(wire, messageSchema, messages, enums),
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
