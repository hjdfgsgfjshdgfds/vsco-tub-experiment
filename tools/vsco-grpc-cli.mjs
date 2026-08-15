#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(scriptDirectory, "..", "docs", "vsco-grpc-schema.json");
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
export { schema };

const EXPLICITLY_BLOCKED = new Set([
  "interaction.InteractionGrpc/TestRPC",
  "interaction.InteractionGrpc/Optout",
  "interaction.InteractionGrpc/InvalidateCollectionCache",
]);

export function classify(service, method) {
  const name = `${service}/${method}`;
  if (EXPLICITLY_BLOCKED.has(name)) return "blocked";
  if (/^Admin/.test(method) || /Internal/.test(method)) return "blocked";
  if (/^(Fetch|Get|Has)/.test(method)) return "read";
  if (/^(CreateFavorite|DeleteFavorite|CreateRepost|DeleteRepost)$/.test(method)) return "reversible-interaction";
  return "mutation";
}

export function findMethod(service, method) {
  const result = schema.services?.[service]?.methods?.find((candidate) => candidate.method === method);
  if (!result) throw new Error(`Unknown RPC: ${service}/${method}`);
  return result;
}

function encodeVarint(input) {
  let value = BigInt(input);
  if (value < 0n) value = BigInt.asUintN(64, value);
  const bytes = [];
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}

function fieldKey(number, wireType) {
  return encodeVarint((BigInt(number) << 3n) | BigInt(wireType));
}

function lengthDelimited(number, value) {
  return Buffer.concat([fieldKey(number, 2), encodeVarint(value.length), value]);
}

function encodeScalar(field, value, messages) {
  const type = field.type;
  if (["Bool", "Enum", "Int32", "Int64", "Uint32", "Uint64", "Sint32", "Sint64"].includes(type)) {
    let encoded = value;
    if (type === "Bool") encoded = value ? 1 : 0;
    if (type === "Sint32" || type === "Sint64") {
      const integer = BigInt(value);
      encoded = (integer << 1n) ^ (integer >> 63n);
    }
    return Buffer.concat([fieldKey(field.number, 0), encodeVarint(encoded)]);
  }
  if (type === "String") return lengthDelimited(field.number, Buffer.from(String(value), "utf8"));
  if (type === "Bytes") {
    const bytes = typeof value === "string" ? Buffer.from(value, "base64") : Buffer.from(value);
    return lengthDelimited(field.number, bytes);
  }
  if (type === "Message" || field.resolvedType) {
    if (!field.resolvedType) throw new Error(`Cannot encode ambiguous message field ${field.name}`);
    const nestedSchema = messages[field.resolvedType];
    if (!nestedSchema) throw new Error(`Missing nested schema ${field.resolvedType}`);
    return lengthDelimited(field.number, encodeMessage(nestedSchema, value, messages));
  }
  if (["Fixed32", "Sfixed32", "Float"].includes(type)) {
    const bytes = Buffer.alloc(4);
    if (type === "Float") bytes.writeFloatLE(Number(value));
    else bytes.writeUInt32LE(Number(value));
    return Buffer.concat([fieldKey(field.number, 5), bytes]);
  }
  if (["Fixed64", "Sfixed64", "Double"].includes(type)) {
    const bytes = Buffer.alloc(8);
    if (type === "Double") bytes.writeDoubleLE(Number(value));
    else bytes.writeBigUInt64LE(BigInt(value));
    return Buffer.concat([fieldKey(field.number, 1), bytes]);
  }
  throw new Error(`Unsupported schema type ${type} for ${field.name}`);
}

export function encodeMessage(messageSchema, input, messages = schema.messages || {}) {
  const knownNames = new Set(messageSchema.fields.map((field) => field.name));
  const unknown = Object.keys(input).filter((name) => !knownNames.has(name));
  if (unknown.length) throw new Error(`Unknown ${messageSchema.fullName || messageSchema.name} field(s): ${unknown.join(", ")}`);

  const chunks = [];
  for (const field of messageSchema.fields) {
    if (!(field.name in input) || input[field.name] === null || input[field.name] === undefined) continue;
    const values = field.repeated ? input[field.name] : [input[field.name]];
    if (field.repeated && !Array.isArray(values)) throw new Error(`${field.name} must be an array`);
    if (field.packed) {
      const packed = Buffer.concat(values.map((value) => encodeVarint(value)));
      chunks.push(lengthDelimited(field.number, packed));
    } else {
      for (const value of values) chunks.push(encodeScalar(field, value, messages));
    }
  }
  return Buffer.concat(chunks);
}

export function grpcWebTextFrame(payload) {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]).toString("base64");
}

async function readJson(argument) {
  if (!argument) return {};
  const text = argument.startsWith("@") ? await readFile(argument.slice(1), "utf8") : argument;
  return JSON.parse(text);
}

function usage() {
  return `Usage:
  vsco-grpc-cli.mjs list [service]
  vsco-grpc-cli.mjs describe <service> <method>
  vsco-grpc-cli.mjs encode <service> <method> <request|response> '<json>'
  vsco-grpc-cli.mjs probe-plan

The CLI never reads or stores authorization. Live transport must use the
separate authenticated-browser bridge. Mutation execution is intentionally
not implemented here.`;
}

async function main(argv) {
const [command, ...arguments_] = argv;
if (command === "list") {
  const selectedService = arguments_[0];
  const rows = [];
  for (const [serviceName, service] of Object.entries(schema.services)) {
    if (selectedService && serviceName !== selectedService) continue;
    for (const method of service.methods) {
      rows.push({ service: serviceName, method: method.method, capability: classify(serviceName, method.method) });
    }
  }
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
} else if (command === "describe") {
  const [service, methodName] = arguments_;
  const method = findMethod(service, methodName);
  process.stdout.write(`${JSON.stringify({ ...method, capability: classify(service, methodName) }, null, 2)}\n`);
} else if (command === "encode") {
  const [service, methodName, direction, jsonArgument] = arguments_;
  if (!new Set(["request", "response"]).has(direction)) throw new Error("Direction must be request or response");
  const method = findMethod(service, methodName);
  const input = await readJson(jsonArgument);
  const payload = encodeMessage(method[direction], input, schema.messages || {});
  process.stdout.write(`${JSON.stringify({
    service,
    method: methodName,
    direction,
    capability: classify(service, methodName),
    protobufBytes: payload.length,
    grpcWebText: grpcWebTextFrame(payload),
  }, null, 2)}\n`);
} else if (command === "probe-plan") {
  const plan = [];
  for (const [serviceName, service] of Object.entries(schema.services)) {
    for (const method of service.methods) {
      if (classify(serviceName, method.method) !== "read") continue;
      plan.push({
        service: serviceName,
        method: method.method,
        requestFields: method.request.fields.map((field) => ({
          name: field.name,
          type: field.resolvedType || field.type,
          repeated: field.repeated,
        })),
      });
    }
  }
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
} else {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = command ? 2 : 0;
}
}

if (typeof process !== "undefined" && process.argv?.[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main(process.argv.slice(2));
}
