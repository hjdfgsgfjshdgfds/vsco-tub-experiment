#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const schemaPath = process.argv[2] || "docs/vsco-grpc-schema.json";
const outputDirectory = process.argv[3] || "proto/vsco-recovered";
const schema = JSON.parse(await readFile(schemaPath, "utf8"));

const scalarTypes = {
  Bool: "bool", Bytes: "bytes", Double: "double", Enum: "int32",
  Int32: "int32", Int64: "int64", Sint64: "sint64", String: "string",
  Uint32: "uint32", Uint64: "uint64",
};

function packageOf(fullName) {
  return fullName.split(".")[0];
}

function leafOf(fullName) {
  return fullName.split(".").at(-1);
}

function fieldType(message, field) {
  if (scalarTypes[field.type]) return scalarTypes[field.type];
  if (!field.resolvedType) return "bytes";
  const targetPackage = packageOf(field.resolvedType);
  return targetPackage === message.namespace ? leafOf(field.resolvedType) : `.${field.resolvedType}`;
}

const packages = new Map();
for (const message of Object.values(schema.messages)) {
  if (!packages.has(message.namespace)) packages.set(message.namespace, []);
  packages.get(message.namespace).push(message);
}

await mkdir(outputDirectory, { recursive: true });
const generated = [];
for (const [packageName, messages] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const imports = new Set();
  for (const message of messages) {
    for (const field of message.fields) {
      if (field.resolvedType && packageOf(field.resolvedType) !== packageName) {
        imports.add(packageOf(field.resolvedType));
      }
    }
  }
  const lines = [
    'syntax = "proto3";',
    "",
    `package ${packageName};`,
    "",
    ...[...imports].sort().map((name) => `import "${name}.proto";`),
  ];
  if (imports.size) lines.push("");
  lines.push(
    "// Recovered statically from VSCO's generated JavaScript client.",
    "// Unresolved message and enum fields intentionally use wire-compatible bytes/int32.",
    "",
  );
  for (const message of messages.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`message ${message.name} {`);
    for (const field of message.fields) {
      const label = field.repeated ? "repeated " : "";
      const ambiguity = !scalarTypes[field.type] && !field.resolvedType
        ? " // unresolved message type; preserved as opaque bytes"
        : field.type === "Enum" ? " // unresolved enum identity; preserved as int32" : "";
      lines.push(`  ${label}${fieldType(message, field)} ${field.name} = ${field.number};${ambiguity}`);
    }
    lines.push("}", "");
  }
  for (const [serviceName, service] of Object.entries(schema.services)) {
    if (packageOf(serviceName) !== packageName) continue;
    lines.push(`service ${leafOf(serviceName)} {`);
    for (const method of service.methods) {
      lines.push(`  rpc ${method.method} (${method.requestType}) returns (${method.responseType});`);
    }
    lines.push("}", "");
  }
  const outputPath = path.join(outputDirectory, `${packageName}.proto`);
  await writeFile(outputPath, `${lines.join("\n").trim()}\n`);
  generated.push(outputPath);
}

process.stdout.write(`${generated.join("\n")}\n`);
