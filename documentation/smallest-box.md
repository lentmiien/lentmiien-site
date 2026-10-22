# Smallest-box packing

`/binpacking-smallest` searches a user's saved box catalog in ascending internal volume (ties use the box ID). It allows 3D rotation, rejects boxes too small for any individual item or the combined volume/weight, and tries the existing packing worker with a one-container limit. Only a complete single-container placement is accepted. The selected algorithm is heuristic: failure means no solution was found, not proof that a mathematical arrangement is impossible. Provider failures stop the search; they must not silently skip a potentially smaller box.

The catalog starts empty. Add real available boxes with internal dimensions in mm, empty weight and maximum contents weight in kg, then save. Zero maximum load permits only weightless contents. The whole list is saved atomically in `packing_container_catalogs`, one document per owner, up to 30 boxes. Removing rows and saving deletes those definitions. Unsaved edits are not used for searches. Items and results are transient. The original `/binpacking` workflow remains available.

## Security contract

- Feature: smallest-box search and editable personal container catalog.
- Security zone: logged-in. Interactive principals: admin, or explicitly granted family/user accounts. Machine principals: none.
- Data classification: private. Capabilities: `packing.container.read`, `packing.container.write`, `packing.search.run`. Admin receives all three by default; family/user receive none by default and may receive explicit grants. No legacy `binpacking` permission is implied.
- Object scope: owner, derived from validated `req.user._id`, including catalog reads, replacement, and searches. No admin override. No client-supplied owner/object identifier is accepted.
- Browser mutations: PUT catalog and POST search use shared session CSRF tokens and Origin validation. GET never creates a catalog.
- Abuse/work limits: 64 KiB JSON, 30 containers, 100 distinct item IDs, 200 total items; bruteforce fewer than 8. Dimensions 0–1,000,000 mm (strictly positive), weights 0–1,000,000 kg, IDs at most 100 characters. One search per owner and two globally per application process, 5 search requests/minute per owner, 30 catalog writes/minute. At most 30 sequential provider calls, 15 seconds per call, 60 seconds total; disconnect aborts work. Multi-process deployments multiply local concurrency/rate limits.
- Output: Pug escaping, DOM textContent, no interpolated script data. Private/no-store responses; analytics disabled. No files or uploads sent to server. CSV files are read locally with a 64 KiB limit on this page.
- Outbound: existing configured `BIN_PACKING_API_URL` only; redirects disabled, bounded request/response sizes, no caller-selected destination. Items/box dimensions go to this local/configured worker.
- Logs: generic actionable database/provider/time-limit failures through shared logger, with error type only; no item/catalog payloads or upstream error text.
- Retention: saved catalog persists until edited/cleared; empty replacement clears all box definitions. No stored search history.
- Negative tests: anonymous/missing capability, cross-owner scope, forged owner, invalid CSRF/Origin, invalid/oversized input, bounded concurrency, incomplete/multiple-box output and provider failure; inert HTML output.
- Legacy dependency: existing worker protocol and browser CSV/3D renderer shared with `/binpacking`; no legacy database data imported.

## Deployment and verification

No new environment variables or dependencies. MongoDB creates the separate collection on first save; its unique owner index is required. No data migration is needed. Grant the three capabilities to non-admin accounts that should use the tool. Do not edge-cache this authenticated route; application checks apply without Cloudflare. Rollback by removing the route/navigation registration; retained catalog data is isolated from the old tool.

Manual check: add and save several box sizes, reload to verify persistence, upload/paste items, compare a successful fit and a no-fit case, then open the 3D preview. Verify removal/editing and an empty catalog. Search always uses the saved list. A failed or timed-out worker should show an error rather than a larger-box recommendation.

Focused verification:

```sh
npm test -- tests/unit/smallestBoxService.test.js tests/unit/smallestBoxRoutes.test.js tests/unit/smallestBoxClient.test.js tests/unit/adminRoleManagement.test.js tests/unit/accountSurfacePolicy.test.js --coverage=false
```

The client tests render the Pug pages in jsdom and exercise catalog editing, saving/removal, inert labels, search submission/results, unsaved/invalid input handling, and the original fixed-container workflow. Service and HTTP tests use isolated data and a mocked worker; they do not require application startup, MongoDB credentials, or a live packing worker.
