# VSCO Interaction API map

Observed from the authenticated VSCO web client and three sanitized Chrome HAR captures on 2026-08-10. This file intentionally excludes authorization values, cookies, response bodies containing account data, and signed URLs.

## Captured media actions

Host: `https://interaction-api-grpc.vsco.co`

Transport:

- unary gRPC-Web requests over `POST`
- `content-type: application/grpc-web-text`
- `x-grpc-web: 1`
- body is a base64-encoded gRPC frame: one flags byte, four big-endian length bytes, then protobuf bytes
- authenticated with the same authorization used by the VSCO web client

Captured successful calls:

| Method | Request protobuf | Purpose |
| --- | --- | --- |
| `CreateFavorite` | field 1 acting `site_id` (int64), field 2 `image_id` (string) | Favorite one image |
| `GetReactionsForMedia` | field 1 viewing `site_id` (int64), field 2 `image_id` (string) | Read the signed-in account's reaction state |
| `CreateRepost` | field 1 `collection_id` (string), field 2 acting `site_id` (int64), field 3 `image_id` (string) | Repost one image |

`GetReactionsForMedia` returns reaction state including `has_activity`, `been_favorited`, and `been_reposted`. The frontend calls it before deciding whether to render Favorite/Unfavorite and Repost/Unrepost.

The matching inverse methods in the current client are `DeleteFavorite` and `DeleteRepost`.

### Verified site-ID roles

A captured media ID was fetched through `media.Media/FetchImages` with
`include_site=true`, then its embedded image-owner `site_id` was compared with
the interaction requests. The `site_id` in `CreateFavorite`, `CreateRepost`, and
`GetReactionsForMedia` matched one another and did not match the image owner.
This proves that those generic interaction `site_id` fields identify the acting
or viewing account, while the media record's `site_id` identifies the uploader.

Fields that are explicitly named `uploader_site_id` or `collector_site_id`
should retain those target roles. A generic `...BySite` request should be tested
with the target user's site ID; its meaning must not be inferred from the actor
fields above.

## Useful read and batch methods

- `GetReactionsForMedias`: batch reaction-state request. Field 1 is the signed-in site ID; repeated field 2 contains `MediaId` messages. This is preferable to one state request per visible card.
- `HasReactions`: fields are uploader site ID and media ID.
- `GetFavorites`
- `GetReposts`
- `GetRepostedMediaIdsForSite`: site ID, page, and size.
- `GetInteractionIdsOfSite`
- `GetInteractionIdsOfSitesMedias`
- `GetActivity`

## Collection methods

- `CreateCollection`
- `FetchCollections`
- `FetchCollectionsBySite`
- `FetchCollectionItemsById`
- `FetchCollectionItemsBySite`
- `FetchCollectionItemBySiteAndMedia`: collector site ID plus media ID.
- `UpdateCollections`

These are VSCO's server-side collection/repost concepts. They are separate from this extension's private local Collection stored in `chrome.storage.local`.

## Full current InteractionGrpc method inventory

- `AdminCreateRepost`
- `AdminDeleteRepost`
- `CreateCollection`
- `CreateFavorite`
- `CreateRepost`
- `DeleteFavorite`
- `DeleteInteractions`
- `DeleteInteractionsOfSitesMedias`
- `DeleteRepost`
- `FetchCollectionItemBySiteAndMedia`
- `FetchCollectionItemsById`
- `FetchCollectionItemsBySite`
- `FetchCollections`
- `FetchCollectionsBySite`
- `GetActivity`
- `GetFavorites`
- `GetInteractionIdsOfSite`
- `GetInteractionIdsOfSitesMedias`
- `GetReactionsForMedia`
- `GetReactionsForMedias`
- `GetRepostedMediaIdsForSite`
- `GetReposts`
- `HasReactions`
- `InvalidateCollectionCache`
- `Optout`
- `TestRPC`
- `UpdateCollections`

Admin, cache invalidation, bulk deletion, opt-out, and test methods must not be exposed as user-facing controls.

`TestRPC` uses a `TestRequest` containing one string field named `id` and returns
a `TestResponse` containing one string field named `response`. The current web
application has no call site that shows what kind of ID is valid. An arbitrary
string is therefore not a meaningful test input. The advertised production
path returned an HTML 404 before gRPC processing.

## Media gRPC evidence

`media.Media/FetchImages` is a unary gRPC-Web `POST`. Its request contains:

- repeated field 1: image IDs
- field 2: `include_site` boolean
- field 3: `include_suspended` boolean

An empty request returned an empty image list with `grpc-status: 0`. A request
containing one captured real image ID and `include_site=true` returned exactly
one image, a 1,447-byte protobuf data message, and `grpc-status: 0`.

The gateway's CORS response advertises `GET, PUT, POST, DELETE, PATCH, OPTIONS`
for the origin. This is a gateway-wide browser access policy, not evidence that
each gRPC method supports those HTTP verbs. Unary gRPC-Web calls observed here
use `POST`; `OPTIONS` is the browser preflight.

Current `media.Media` client inventory from the web bundle:

- read-oriented: `FetchActiveImagesBySite`, `FetchArticleByPermalink`,
  `FetchArticles`, `FetchArticlesByImageID`, `FetchArticlesBySite`,
  `FetchFeedback`, `FetchFeedbackBatch`, `FetchImage`, `FetchImages`,
  `FetchImagesByAlbum`, `FetchImagesBySite`, `FetchImagesByUserAndTag`,
  `FetchPersonalMedia`, `FetchProfileImage`, `FetchProfileImages`,
  `FetchSlimArticles`, `FetchUserComments`
- account-changing: `ConfigureFeedback`, `DeleteComment`, `DeleteImage`,
  `GenerateUploadUrl`, `ImageUploadComplete`, `InsertComment`, `IntentToUpload`,
  `UpdateArticles`, `UpdateImages`
- internal/admin: `AdminCreateArticle`, `AdminDeleteArticle`,
  `AdminDeleteComment`, `AdminFetchArticle`, `AdminFetchComment`,
  `AdminFetchImage`, `AdminUpdateArticle`, `FetchImagesInternal`,
  `ImageUploadCompleteInternal`

## Follow API

Follow state is a separate REST API:

- `GET /api/2.0/follows/{site_id}`
- `POST /api/2.0/follows/{site_id}`
- `DELETE /api/2.0/follows/{site_id}`

## Remaining implementation boundary

Direct search-card Favorite/Repost controls require:

1. a safe way for the extension to use the authenticated web client's authorization without logging or persisting the token;
2. protobuf and gRPC-Web frame encoding/decoding;
3. a bounded `GetReactionsForMedias` state read for only the progressively rendered cards;
4. optimistic UI with rollback on RPC failure;
5. both create and delete paths verified live.

No messaging RPC service was present in the currently loaded web bundle. Messaging should remain a separate discovery task rather than being inferred from the interaction service.
