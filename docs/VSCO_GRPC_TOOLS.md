# VSCO gRPC-Web schema and decoder tools

Generated from the VSCO web client's protobuf/gRPC-Web JavaScript on
2026-08-12. No authorization values, cookies, session tokens, or response data
are stored in these artifacts.

## Coverage

- `media.Media`: 36 unique unary RPC methods
- `interaction.InteractionGrpc`: 27 unique unary RPC methods
- 63 root request schemas
- 63 root response schemas
- 164 reachable nested message schemas, including ambiguous candidate types
- 317 generated protobuf enum and oneof-case maps found in the bundle

The complete machine-readable evidence map is `vsco-grpc-schema.json`. A
generated client method appearing in the bundle does not prove that its route
is still deployed on a production gateway.

Seven nested type references remain explicitly ambiguous because webpack
minification replaced their package names with local aliases and several VSCO
packages export the same leaf names:

- `grid.Image.site`
- `media.MediaContent.video`
- `journal.Article.site`
- `media.Feedback.creatorSite`
- `media.Comment.fromSite`
- `collection.CollectionItem.media`
- `collection.CollectionItem.video`

The JSON lists the candidate fully-qualified types for each ambiguity. Do not
select one without additional generated-code or live-response evidence.

## Recovered proto sources and descriptor set

The repository now generates package-separated proto sources in
`proto/vsco-recovered/` and a binary descriptor set at `docs/vsco-grpc.desc`.
The descriptor is suitable for Proxyman's Protobuf descriptor import.

```sh
npm install
npm run grpc:generate
```

Fields whose message identity is one of the seven ambiguities above are emitted
as wire-compatible `bytes`. Fields known to be enums but whose enum identity
could not be recovered are emitted as wire-compatible `int32`. This preserves
the captured wire format without inventing semantic types.

Captured `GetActivity` payloads prove that `interaction.Activity.site` is the
rich `sites.Site` message. The decoder now expands that nested record and labels
the exact generated enums: reaction `1=REACTION_REPOST`,
`2=REACTION_FAVORITE`; follow status `1=STATUS_INACTIVE`,
`2=STATUS_ACTIVE`.

Validate captured HAR exchanges against the generated proto definitions:

```sh
node tools/validate-vsco-descriptor.mjs \
  /path/to/media-capture.har \
  /path/to/interaction-capture.har
```

The validator removes HAR and gRPC-Web base64 layers, parses data and trailer
frames, decodes using `protobufjs`, and requires request decode/re-encode to be
byte-for-byte exact. On the 2026-08-11 Proxyman captures it decoded 20 exchanges
and all 20 requests round-tripped exactly. The evidence includes FetchImages,
GetReactionsForMedia, Create/DeleteFavorite, and Create/DeleteRepost. One
GetReactionsForMedia response contained decoded favorite state and timestamps;
the other successful mutation responses contained genuinely empty protobuf
messages.

## Decode copied gRPC-Web data

Decode an empty `FetchImages` request:

```sh
node tools/decode-grpc-web.mjs \
  --service media.Media \
  --method FetchImages \
  --direction request \
  AAAAAAA=
```

Decode a response copied into a file:

```sh
node tools/decode-grpc-web.mjs \
  --service media.Media \
  --method FetchImages \
  --direction response \
  @/path/to/base64-response.txt
```

Use `-` to read the base64 body from standard input. The decoder supports both
one base64 stream containing multiple frames and separately padded base64 data
and trailer frames. It labels protobuf fields, follows resolved nested message
types, preserves unknown bytes as base64, and prints gRPC trailer headers.

Do not paste request headers or whole curl commands into decoder input. It only
needs the base64 body and never needs authorization.

## Explore and encode RPCs

The CLI classifies the current surface into read, reversible-interaction,
mutation, and blocked capabilities. It never reads authorization and has no
live mutation transport.

```sh
node tools/vsco-grpc-cli.mjs list
node tools/vsco-grpc-cli.mjs describe media.Media FetchImages
node tools/vsco-grpc-cli.mjs probe-plan
node tools/vsco-grpc-cli.mjs encode \
  media.Media FetchImages request \
  '{"idsList":["IMAGE_ID"],"includeSite":true}'
```

Current policy classification:

- 32 read methods
- 4 reversible interactions: create/delete Favorite and Repost
- 13 other mutations
- 14 blocked admin, internal, cache, opt-out, or unknown test methods

Encoding a mutation only produces protobuf bytes. It does not transmit them.
Live mutation commands should require a state snapshot, one bounded action,
verification, and restoration where restoration is genuinely possible.

## Bounded live read-probe evidence

`vsco-grpc-read-probes-2026-08-10.json` records a sanitized 26-method batch
using one known actor, uploader, image, user, and collection. Identifiers and
authorization are omitted. All list requests used limits of one or two.

- 7 methods returned valid gRPC data/trailer frames with `grpc-status: 0`
- 11 returned HTTP 200 but no gRPC frames or trailer and remain inconclusive
- 8 returned gateway HTML 404 responses
- 0 mutations were sent

An HTTP 200 without a gRPC trailer is not counted as an RPC success. An HTML
404 means the generated client path was not routed on the tested production
host; it is not a protobuf-level response.

## Refresh schemas after a VSCO bundle update

```sh
node tools/extract-vsco-grpc-schema.mjs /path/to/current-vsco-bundle.js \
  > docs/vsco-grpc-schema.json
```

The extractor statically parses the generated bundle. It does not evaluate
VSCO code and does not access a browser profile.

## Current tooling choices

- The checked-in generator plus the locally pinned `grpc-tools` compiler builds
  the descriptor reproducibly; Buf remains a useful maintained linting and
  breaking-change tool if the schema is promoted beyond reverse-engineering.
- The official `grpc/grpc-web` runtime and protocol documents are the transport
  authority for the framing used by VSCO.
- `grpcurl` is useful with reflection, `.proto` source, or a descriptor set, but
  it targets native gRPC and cannot infer this private browser gRPC-Web schema.
- The older `grpc-web-devtools` browser extension is not required by this
  workflow.

VSCO's gateway CORS header may list `GET, PUT, POST, DELETE, PATCH, OPTIONS`.
That is an origin-level gateway allow-list, not a per-RPC verb declaration.
The unary gRPC-Web calls captured here use `POST`; browsers use `OPTIONS` for
CORS preflight.
