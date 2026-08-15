#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import protobuf from "protobufjs";

const harPaths = process.argv.slice(2);
if (!harPaths.length) {
  console.error("Usage: validate-vsco-descriptor.mjs <capture.har> [...]");
  process.exit(2);
}

const root = await protobuf.load([
  "proto/vsco-recovered/media.proto",
  "proto/vsco-recovered/interaction.proto",
]);

function decodeTextStream(value) {
  const segments = value.match(/(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)/g) || [];
  if (!segments.length && value) return Buffer.from(value, "base64");
  return Buffer.concat(segments.map((segment) => Buffer.from(segment, "base64")));
}

function grpcFrames(buffer) {
  const frames = [];
  for (let offset = 0; offset + 5 <= buffer.length;) {
    const flags = buffer[offset];
    const length = buffer.readUInt32BE(offset + 1);
    if (offset + 5 + length > buffer.length) throw new Error(`truncated frame at ${offset}`);
    frames.push({ flags, body: buffer.subarray(offset + 5, offset + 5 + length) });
    offset += 5 + length;
  }
  return frames;
}

function safeObject(type, body) {
  const message = type.decode(body);
  return type.toObject(message, { longs: String, bytes: String, defaults: false });
}

const results = [];
for (const harPath of harPaths) {
  const har = JSON.parse(await readFile(harPath, "utf8"));
  for (const entry of har.log.entries) {
    const pathname = new URL(entry.request.url).pathname;
    const match = pathname.match(/^\/([^/]+)\/([^/]+)$/);
    if (!match || !root.lookupService(match[1], null)) continue;
    const service = root.lookupService(match[1]);
    const method = service.methods[match[2]];
    if (!method) continue;
    const requestText = entry.request.postData?.text || "";
    let responseText = entry.response.content?.text || "";
    if (entry.response.content?.encoding === "base64") responseText = Buffer.from(responseText, "base64").toString("ascii");
    const requestFrames = grpcFrames(decodeTextStream(requestText)).filter((frame) => !(frame.flags & 0x80));
    const responseFrames = grpcFrames(decodeTextStream(responseText)).filter((frame) => !(frame.flags & 0x80));
    const requestType = root.lookupType(method.requestType);
    const responseType = root.lookupType(method.responseType);
    const request = requestFrames.map((frame) => safeObject(requestType, frame.body));
    const response = responseFrames.map((frame) => safeObject(responseType, frame.body));
    const reencoded = requestFrames.every((frame, index) => requestType.encode(requestType.fromObject(request[index])).finish().equals(frame.body));
    results.push({ path: pathname, requestFrames: request.length, responseFrames: response.length, requestRoundTripExact: reencoded, request, response });
  }
}

process.stdout.write(`${JSON.stringify({ captures: results.length, results }, null, 2)}\n`);
