# Smallest Box Finder API: client integration

Use this API to build a second app that lists available boxes, offers tag filters, and displays a single-box packing result. The source site maintains the shared box catalog. API clients can read it and run searches, but cannot edit it.

## 1. Connect

On the source site's `/binpacking-smallest` page, open **API access**, create a named key for the second app, and copy it immediately. Keys expire after the selected 1–365 days and can be revoked there. Existing packing keys work with both endpoints.

Use the source site's HTTPS origin as `SITE_URL` (without a trailing slash). Send `Authorization: Bearer <key>` on every request. Cookies and the legacy global API key do not authenticate these endpoints. The issuer must retain packing read, search, and API-management permissions.

For a web app, keep the key in the second app's backend configuration and proxy these calls through that backend. Do not embed it in a browser bundle or local storage. Authenticate and authorize your own app's users before allowing proxy calls. Cross-origin browser access is not enabled by these routes; no browser CSRF token is needed for backend bearer requests.

## 2. Load boxes and tag controls

```sh
curl "$SITE_URL/api/binpacking-smallest/containers" \
  -H "Authorization: Bearer $PACKING_API_KEY"
```

Example response (HTTP 200):

```json
{
  "containers": [
    {"id":"Box S","w":200,"d":150,"h":100,"emptyWeight":0.1,"maxLoadWeight":5,"tags":["small-box","fold-box"]}
  ],
  "revision": 4,
  "tags": ["fold-box","small-box"]
}
```

`containers` contains up to 50 boxes. Dimensions are internal **millimeters**; weights are **kilograms**. `emptyWeight` is the box weight; `maxLoadWeight` is the maximum contents weight, excluding the box. Zero load capacity permits weightless contents only. IDs are unique labels, not database IDs. Each box has a `tags` array, possibly empty.

The top-level `tags` array is the sorted, unique union of all box tags. Use it to build Default / Require / Require not controls. No separate tags request is needed. An empty catalog returns `containers: []` and `tags: []`. There are no query parameters, pagination, or filters on this endpoint.

Load this snapshot when opening the tool, and offer a refresh. `revision` identifies the snapshot; do not send it in a search. Searches always use the current saved catalog, which may have changed since the list was fetched. Responses are private and `no-store`.

## 3. Request a packing solution

```sh
curl "$SITE_URL/api/binpacking-smallest" \
  -H "Authorization: Bearer $PACKING_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"items":[{"id":"widget","w":100,"d":80,"h":50,"weight":0.2,"qty":2}],"algorithm":"laff","tagFilter":{"require":["fold-box"],"requireNot":["tube"]}}'
```

Each item requires `id`, `w`, `d`, `h`, `weight`, and `qty`. Weight is per item. IDs must be unique, nonempty, and at most 100 characters. Dimensions must be positive and at most 1,000,000; weights must be between 0 and 1,000,000. Quantities are positive integers. Send at most 100 item types and 200 total items. The JSON body limit is 64 KiB. Unknown fields are rejected; do not send boxes, a catalog revision, or owner IDs.

`algorithm` is optional and defaults to `laff`. Alternatives are `plain` and `bruteforce`; bruteforce permits at most 7 total items. All items may rotate in 3D. Boxes are filtered by tags, dimensions, combined volume and contents weight, then tried in ascending volume until one complete solution is found.

`tagFilter` is optional. Each of its `require` and `requireNot` arrays allows up to 20 tags. Tags are trimmed and lowercased, contain 1–40 letters, digits, hyphens or underscores, and start with a letter or digit.

- A match in `requireNot` excludes the box, even if a `require` tag also matches.
- Boxes with no matching filter tags remain included, including untagged boxes.
- `require` is not a whitelist: positive tags alone exclude nothing. Omitted/empty filters include all boxes.

## 4. Display the result

A successful search returns HTTP 200 with `success: true`, `container` (the chosen box, including tags), `data.pallets` (exactly one container), and `meta` (search counts). For example, the two widgets above could yield these placements:

```json
{
  "success": true,
  "container": {"id":"Box S","w":200,"d":150,"h":100,"emptyWeight":0.1,"maxLoadWeight":5,"tags":["small-box","fold-box"]},
  "data": {
    "success": true,
    "pallets": [{
      "containerId":"Box S","w":200,"d":150,"h":100,
      "placements": [
        {"itemId":"widget","x":0,"y":0,"z":0,"w":100,"d":80,"h":50},
        {"itemId":"widget","x":100,"y":0,"z":0,"w":100,"d":80,"h":50}
      ]
    }]
  },
  "meta": {"algorithm":"laff","totalItemCount":2,"uniqueItems":1,"totalContainers":1,"tagFilteredContainers":0,"eligibleContainers":1,"filteredContainers":0,"attempts":1,"containerId":"Box S","containerVolume":3000000}
}
```

Show the chosen box ID, dimensions, and placement list. Each placement represents one physical item, so repeated `itemId` values correspond to quantity. Match those IDs to your submitted items for labels/colors. Additional worker fields may be present; the fields above are sufficient to render a solution.

For a 3D preview, coordinates are in mm from a container corner: `x` is width, `y` is depth, and `z` is height. A placement's `x/y/z` is its minimum corner; `w/d/h` are its dimensions **after rotation**. Use the returned dimensions, not the original item orientation. In a renderer with Y up, use cuboid dimensions `(w, h, d)` and center `(x + w/2, z + h/2, y + d/2)`. Apply the same scale to all dimensions and coordinates. Render IDs/tags as text, never HTML.

`meta.attempts` counts worker calls; `eligibleContainers` counts boxes remaining after all filters; `filteredContainers` counts all rejected boxes, including `tagFilteredContainers`. Volume is in cubic millimeters. Calculate total shipping weight as `container.emptyWeight + sum(item.weight * item.qty)` if needed.

No fit also returns HTTP 200, with `success: false`, `message`, and `meta`, and no solution. Check `success` before accessing `container` or `data`. Display the message and offer another algorithm or changed inputs. The algorithm is heuristic; no fit does not prove packing is mathematically impossible. Clear any previous result when beginning a new search or receiving an error.

## 5. Handle errors and limits

| HTTP status | Client action |
| --- | --- |
| 400 | Fix invalid input or remove query parameters. |
| 401 | Replace an expired/revoked key or restore issuer permissions; do not retry unchanged. |
| 404 | Check the path/method; catalog writes are not available. |
| 413 | Reduce the search body below 64 KiB. |
| 429 | Wait before retrying; honor `Retry-After` when present. |
| 503 | Show temporary unavailability; offer a delayed retry. |

Errors from these routes use `{ "success": false, "message": "..." }`; also handle non-JSON network/proxy failures. Limit searches to one at a time. The API allows 60 requests/minute/IP overall and 5 searches/minute per key issuer, shared across that issuer's keys and browser searches. Only one search per issuer and two globally per application process may run at once. Catalog reads do not consume search quota.

Packing has a 60-second overall worker budget and a 15-second timeout per worker call. Allow more than 60 seconds for your backend/proxy response timeout (for example, 75 seconds). Avoid automatic retry loops or starting searches on every input change.

The [OpenAPI specification](../public/yaml/binpacking-smallest.v1.yaml) is also served at `/yaml/binpacking-smallest.v1.yaml` on the source site.
