# Website pictures: storage, retire and cleanup (V-C2)

Website pictures are uploaded by an owner or admin, re-made on the server (JPEG/PNG/WebP in; metadata removed; stored as WebP, longest side at most 2400 px)
and kept in the **private photo store** under `website-assets/<id>.webp`. The public reads them only through `/api/site-media/<id>`, and only once the
picture is **PUBLIC**. The storage token is never sent to a browser.

## States
- **DRAFT** — uploaded; visible only to a signed-in owner/admin (`/api/desk/site-media/<id>`, never cached).
- **PUBLIC** — became public in the same database step that published a website version (or saved a catalog photo) that uses it.
- **RETIRED** — never served again. A picture still used by the live website, the open draft or a catalog photo cannot be retired.

## Cleanup
`cleanupStaleDraftAssets({ olderThanDays: 14, limit: 50 })` (`src/domains/site-content/assets.ts`) removes only DRAFT pictures older than the cutoff that
nothing refers to, deleting the stored file first and the row second. It never touches PUBLIC or retired pictures, is safe to repeat, and is bounded.
It is not scheduled yet; run it from a script only after the owner agrees. Do not delete objects under `website-assets/` by hand: a missing file for a
PUBLIC picture shows as a broken image on the live site.

## Known gap (open item)
The daily media-copy does not yet include `website-assets/`. The picture rows are in the database backup, but the bytes are not copied to the recovery
area. Until that is added, keep the originals of anything important. Tracked in `docs/STATUS.md`.

## If storage is not set up
Uploads answer "Picture storage is not set up in this environment yet"; the public site keeps showing its existing pictures. Preview deployments use the
verified preview store only and never fall back to production storage.
