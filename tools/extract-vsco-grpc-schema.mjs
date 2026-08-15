#!/usr/bin/env node

/**
 * Extract gRPC-Web service and root message metadata from a VSCO webpack bundle.
 *
 * This intentionally performs static parsing only. It never evaluates the
 * bundle and never reads credentials. The output is an evidence map rather
 * than an assertion that every generated client route remains deployed.
 */

const SERVICE_FILTERS = new Set([
  "interaction.InteractionGrpc",
  "media.Media",
]);

// Resolutions proven by captured production payload structure. Keep this list
// deliberately narrow: aliases not listed here remain explicit candidates.
const EVIDENCE_TYPE_RESOLUTIONS = new Map([
  ['interaction.Activity:site', 'sites.Site'],
]);

function lowerFirst(value) {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function findBalancedBody(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  return null;
}

function parseMethodDescriptors(source) {
  const descriptor = /new\s+[\w$]+\.web\.MethodDescriptor\("\/([^/]+)\/([^"/]+)",[^,]+,([\w$.]+),([\w$.]+)/g;
  const methods = [];
  for (const match of source.matchAll(descriptor)) {
    const [, service, method, requestExpression, responseExpression] = match;
    if (!SERVICE_FILTERS.has(service)) continue;
    methods.push({
      service,
      method,
      path: `/${service}/${method}`,
      transport: "unary",
      httpMethod: "POST",
      requestType: requestExpression.split(".").at(-1),
      responseType: responseExpression.split(".").at(-1),
    });
  }
  return [...new Map(methods.map((method) => [method.path, method])).values()];
}

function parseObjectFieldNames(source, namespace, typeName) {
  const marker = `proto.${namespace}.${typeName}.toObject=function`;
  const body = findBalancedBody(source, marker);
  if (!body) return { byName: new Map(), byNumber: new Map() };
  const objectStart = body.indexOf("={");
  const objectEnd = body.indexOf("};return", objectStart);
  if (objectStart < 0 || objectEnd < 0) return { byName: new Map(), byNumber: new Map() };
  const objectText = body.slice(objectStart + 2, objectEnd);
  const byName = new Map();
  const byNumber = new Map();
  const properties = [...objectText.matchAll(/(?:^|,)([A-Za-z_$][\w$]*):/g)];
  for (const match of properties) {
    byName.set(match[1].replace(/List$/, ""), match[1]);
  }
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index];
    const end = properties[index + 1]?.index ?? objectText.length;
    const expression = objectText.slice(property.index, end);
    const fieldNumber = expression.match(/Message\.(?:get(?:Boolean)?Field(?:WithDefault)?|getOptionalFloatingPointField)\(t,(\d+)/)?.[1];
    if (fieldNumber) byNumber.set(Number(fieldNumber), property[1]);
  }
  return { byName, byNumber };
}

function parseMessage(source, namespace, typeName) {
  const marker = `proto.${namespace}.${typeName}.serializeBinaryToWriter=function`;
  const body = findBalancedBody(source, marker);
  if (body === null) return { name: typeName, namespace, found: false, fields: [] };

  const objectNames = parseObjectFieldNames(source, namespace, typeName);
  const fields = [];
  const writePattern = /(?:e\.get([A-Za-z0-9_$]+)\(\)|Message\.getField\(e,(\d+)\)|r=e\.get([A-Za-z0-9_$]+)\(\))[\s\S]{0,180}?t\.write(Repeated|Packed)?([A-Za-z0-9_$]+)\((\d+),r(?:,([A-Za-z0-9_$.]+)\.serializeBinaryToWriter)?\)/g;

  for (const match of body.matchAll(writePattern)) {
    const [, getterA, directField, getterB, collectionKind, scalarType, fieldNumber, messageExpression] = match;
    const getter = getterA || getterB || null;
    const inferredName = getter
      ? lowerFirst(getter).replace(/_as(?:B64|U8)$/, "")
      : `field${directField || fieldNumber}`;
    const objectName = objectNames.byNumber.get(Number(fieldNumber))
      || objectNames.byName.get(inferredName)
      || objectNames.byName.get(inferredName.replace(/List$/, ""));
    fields.push({
      number: Number(fieldNumber),
      name: objectName || inferredName.replace(/List$/, ""),
      getter: getter ? `get${getter}` : null,
      type: scalarType === "Message" ? messageExpression?.split(".").at(-1) || "message" : scalarType,
      typeExpression: scalarType === "Message" ? messageExpression || null : null,
      repeated: collectionKind === "Repeated" || collectionKind === "Packed",
      packed: collectionKind === "Packed",
    });
  }

  const uniqueFields = [...new Map(fields.map((field) => [field.number, field])).values()]
    .sort((left, right) => left.number - right.number);
  return { name: typeName, namespace, found: true, fields: uniqueFields };
}

function indexGeneratedMessages(source) {
  const names = new Set();
  for (const match of source.matchAll(/proto\.([A-Za-z0-9_$.]+)\.serializeBinaryToWriter=function/g)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

function parseFullMessage(source, fullName) {
  const parts = fullName.split(".");
  const typeName = parts.pop();
  const namespace = parts.join(".");
  return { fullName, ...parseMessage(source, namespace, typeName) };
}

function resolveFieldTypeFromGetter(source, fullName, getter) {
  if (!getter) return null;
  const body = findBalancedBody(source, `proto.${fullName}.prototype.${getter}=function`);
  if (body === null) return null;
  const match = body.match(/Message\.get(?:Repeated)?WrapperField\(this,proto\.([A-Za-z0-9_$.]+),\d+/);
  return match?.[1] || null;
}

function resolveFieldTypeFromAdder(source, fullName, getter) {
  if (!getter) return null;
  const suffix = getter.replace(/^get/, "").replace(/List$/, "");
  const body = findBalancedBody(source, `proto.${fullName}.prototype.add${suffix}=function`);
  if (body === null) return null;
  return body.match(/Message\.addToRepeatedWrapperField\([^)]*proto\.([A-Za-z0-9_$.]+)/)?.[1] || null;
}

function resolveReachableMessages(source, rootNames) {
  const available = indexGeneratedMessages(source);
  const byLeaf = new Map();
  for (const fullName of available) {
    const leaf = fullName.split(".").at(-1);
    if (!byLeaf.has(leaf)) byLeaf.set(leaf, []);
    byLeaf.get(leaf).push(fullName);
  }

  const aliasResolutions = new Map();
  for (const fullName of available) {
    const topNamespace = fullName.split(".")[0];
    const message = parseFullMessage(source, fullName);
    for (const field of message.fields) {
      if (!field.typeExpression) continue;
      const direct = resolveFieldTypeFromGetter(source, fullName, field.getter)
        || resolveFieldTypeFromAdder(source, fullName, field.getter);
      if (direct) aliasResolutions.set(`${topNamespace}:${field.typeExpression}`, direct);
    }
  }

  const messages = {};
  const queue = [...new Set(rootNames)];
  while (queue.length) {
    const fullName = queue.shift();
    if (messages[fullName]) continue;
    const message = parseFullMessage(source, fullName);
    messages[fullName] = message;
    for (const field of message.fields) {
      if (!field.typeExpression) continue;
      const leaf = field.typeExpression.split(".").at(-1);
      const candidates = byLeaf.get(leaf) || [];
      const currentNamespace = fullName.split(".").slice(0, -1).join(".");
      const topNamespace = fullName.split(".")[0];
      const sameNamespace = candidates.filter((candidate) => candidate.startsWith(`${currentNamespace}.`));
      const getterType = resolveFieldTypeFromGetter(source, fullName, field.getter);
      const aliasType = aliasResolutions.get(`${topNamespace}:${field.typeExpression}`);
      const evidenceType = EVIDENCE_TYPE_RESOLUTIONS.get(`${fullName}:${field.name}`);
      const resolved = evidenceType || getterType || aliasType || (candidates.length === 1 ? candidates[0] : sameNamespace.length === 1 ? sameNamespace[0] : null);
      field.resolvedType = resolved;
      if (!resolved && candidates.length) {
        field.typeCandidates = candidates;
        // Preserve every ambiguous candidate in the evidence map. This lets
        // captured wire data decide the type later without re-running bundle
        // extraction or guessing from a leaf name alone.
        candidates.forEach((candidate) => { if (!messages[candidate]) queue.push(candidate); });
      }
      if (resolved && !messages[resolved]) queue.push(resolved);
    }
  }
  return messages;
}

function extractEnums(source) {
  const enums = {};
  const pattern = /proto\.([A-Za-z0-9_$.]+)=\{([^{}]{1,4000})\}/g;
  for (const match of source.matchAll(pattern)) {
    const values = {};
    for (const entry of match[2].matchAll(/(?:^|,)([A-Za-z_$][\w$]*):(-?\d+)/g)) {
      values[entry[1]] = Number(entry[2]);
    }
    if (Object.keys(values).length) enums[match[1]] = values;
  }
  return Object.fromEntries(Object.entries(enums).sort(([left], [right]) => left.localeCompare(right)));
}

export function extractVscoGrpcSchema(source) {
  const methods = parseMethodDescriptors(source);
  const services = {};
  const rootNames = [];
  for (const method of methods) {
    const namespace = method.service.split(".")[0];
    rootNames.push(`${namespace}.${method.requestType}`, `${namespace}.${method.responseType}`);
    services[method.service] ||= { methods: [] };
    services[method.service].methods.push({
      ...method,
      request: parseMessage(source, namespace, method.requestType),
      response: parseMessage(source, namespace, method.responseType),
    });
  }
  for (const service of Object.values(services)) {
    service.methods.sort((left, right) => left.method.localeCompare(right.method));
  }
  const messages = resolveReachableMessages(source, rootNames);
  for (const [serviceName, service] of Object.entries(services)) {
    const namespace = serviceName.split(".")[0];
    for (const method of service.methods) {
      method.request = messages[`${namespace}.${method.requestType}`] || method.request;
      method.response = messages[`${namespace}.${method.responseType}`] || method.response;
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    source: "VSCO generated web client bundle",
    caveat: "Generated client presence does not prove that a production route is deployed.",
    services,
    messages,
    enums: extractEnums(source),
  };
}

if (typeof process !== "undefined" && process.argv?.[1] && (await import("node:url")).fileURLToPath(import.meta.url) === (await import("node:path")).resolve(process.argv[1])) {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error("Usage: extract-vsco-grpc-schema.mjs <vsco-bundle.js>");
    process.exitCode = 2;
  } else {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(sourcePath, "utf8");
    process.stdout.write(`${JSON.stringify(extractVscoGrpcSchema(source), null, 2)}\n`);
  }
}
