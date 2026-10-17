# V-C1 and V-C2 — typed website content and the website photo library (approved original subsections)
Source: docs/designs/BATCH-V.md D-VC1 and D-VC2 (2026-10-08 amendment, authorized by the owner's request for complete website control). Prerequisite W-20 merged (#486).
One coherent outcome: the website content model can hold text, links, pictures, lists and promotions as typed values with safe rules, old text revisions keep working unchanged, and the owner has a private photo library whose pictures become public only when a reviewed revision is published.

## Frozen original complete acceptance
### V-C1
- An additive migration gives every website revision a content version (starting at 1) and an optional template version, every existing revision keeps working unchanged, and a populated-upgrade test proves old revisions read the same after the migration.
- A typed value set exists for text, link, image, list and promotion content plus an explicit hidden value, with strict validation: plain text only, one level of list nesting, picture focus points as whole numbers 0 to 100, UTC start and end times with the end after the start, and a known value of the wrong type is an explicit error rather than text such as [object Object].
- Links use an explicit target set (a known page on this site with a permitted anchor, an HTTPS web address, or a phone number or email bound to the verified business profile); credentials in a link, protocol-relative, script, data and other schemes are refused, and outside links carry safe rel attributes.
- The registry describes every field with a stable key, plain label and help, page and section, where it appears, value kind, starting text, required or optional, limits, allowed placeholders, a preview anchor and source ownership, keeps every existing key through a compatibility mapping, and declares phone, email, address, hours and prices as coming from their existing owner screens rather than editable website text.
- A content reader decodes version 1 (plain text) and version 2 (typed) revisions, treats a missing field as its starting value, an intentionally empty optional field as different from missing, and hidden as explicit, keeps unknown or retired keys in history without showing them, and refuses new unknown keys when saving or publishing.
- Existing readers (published content, revision preview, editor state, the public pages) return exactly the same text through a version adapter, new drafts are saved as version 2, and old or published revisions are never rewritten.
### V-C2
- An additive migration creates the website picture table with a draft, public or retired state, content hash, type, size, who and when, picture ids resolve only in that table, and a customer, receipt or job photo (or any storage path) can never be used as a website picture.
- Only an active owner or admin can upload; the file must really be a JPEG, PNG or WebP by its content (not its name), at most 10 MB and 24 megapixels; metadata is removed and a deterministic WebP is stored at a server-chosen name; SVG, HTML, disguised or oversize files and remote addresses are refused with plain messages and nothing is stored.
- A draft picture is served only to an active owner or admin by a no-store preview route; a public picture is served by the public media route with the verified content type, no sniffing, a long immutable cache and no token; draft, retired and unknown pictures are never served publicly and the routes reveal nothing about other pictures.
- Publishing a website revision marks exactly the pictures it uses as public in the same transaction that moves the live pointer, after checking each picture exists and is stored; a missing, retired or unknown picture blocks publishing with a plain message naming the field, and a repeat or stale publish never exposes extra pictures.
- Retiring a picture stops new selection but never deletes bytes that a kept or restorable revision uses, and a bounded maintenance step removes only old unreferenced draft uploads, never public or referenced pictures.
- When private picture storage is not configured the owner is told plainly what is missing (no purchase, no fallback to production storage), built-in pictures stay selectable, and a picture's description, decorative choice and focus point are stored with it and shown in a crop preview.
- The catalog photo setter now checks the signed-in owner or admin in the domain (not only in the form), accepts only an HTTPS address or a public website picture, and records the change in the activity log in the same transaction.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "05d50606230885d3bf3b6fd48997d4be1dcf5a59",
  "outcome": "The website content registry describes every kind of content with typed, validated values and a compatibility reader for old text revisions, and website pictures can be uploaded, cleaned, kept private as drafts, published together with the revision that uses them, retired and served safely.",
  "integrationBoundary": "The site-content domain (fields, new types/codec/links, revision save/publish/restore), two additive migrations (revision content version, website assets), a new asset domain with an image-processing step and a storage interface, three route handlers (authenticated upload, public media, draft preview media), the catalog photo setter's validation, and the existing website editor action messages. Public pages keep reading strings through the adapter; converting every page is V-C3.",
  "newEngineering": "Typed value model and validators, link target rules, versioned content codec, registry metadata, revision content version, asset table and states, image decoding and deterministic re-encoding with metadata removal, storage interface with an in-memory test store, authenticated upload, public and draft serving routes, publish-time asset promotion, retire and bounded cleanup, catalog photo setter hardening, tests, docs",
  "estimatedProductionLines": 1250,
  "relatedWorkDecision": "V-C2 stores pictures that V-C1's image value points to and publication promotes them in the same transaction that moves the pointer, so the two share one review. Both are foundations: no public page changes yet (V-C3), so nothing a visitor sees can change in this bundle.",
  "subsections": [
    {
      "id": "V-C1",
      "acceptance": [
        "An additive migration gives every website revision a content version (starting at 1) and an optional template version, every existing revision keeps working unchanged, and a populated-upgrade test proves old revisions read the same after the migration.",
        "A typed value set exists for text, link, image, list and promotion content plus an explicit hidden value, with strict validation: plain text only, one level of list nesting, picture focus points as whole numbers 0 to 100, UTC start and end times with the end after the start, and a known value of the wrong type is an explicit error rather than text such as [object Object].",
        "Links use an explicit target set (a known page on this site with a permitted anchor, an HTTPS web address, or a phone number or email bound to the verified business profile); credentials in a link, protocol-relative, script, data and other schemes are refused, and outside links carry safe rel attributes.",
        "The registry describes every field with a stable key, plain label and help, page and section, where it appears, value kind, starting text, required or optional, limits, allowed placeholders, a preview anchor and source ownership, keeps every existing key through a compatibility mapping, and declares phone, email, address, hours and prices as coming from their existing owner screens rather than editable website text.",
        "A content reader decodes version 1 (plain text) and version 2 (typed) revisions, treats a missing field as its starting value, an intentionally empty optional field as different from missing, and hidden as explicit, keeps unknown or retired keys in history without showing them, and refuses new unknown keys when saving or publishing.",
        "Existing readers (published content, revision preview, editor state, the public pages) return exactly the same text through a version adapter, new drafts are saved as version 2, and old or published revisions are never rewritten."
      ],
      "remainingEngineering": [
        "Typed values, link rules, codec, registry metadata, revision migration, adapter, tests, docs"
      ]
    },
    {
      "id": "V-C2",
      "acceptance": [
        "An additive migration creates the website picture table with a draft, public or retired state, content hash, type, size, who and when, picture ids resolve only in that table, and a customer, receipt or job photo (or any storage path) can never be used as a website picture.",
        "Only an active owner or admin can upload; the file must really be a JPEG, PNG or WebP by its content (not its name), at most 10 MB and 24 megapixels; metadata is removed and a deterministic WebP is stored at a server-chosen name; SVG, HTML, disguised or oversize files and remote addresses are refused with plain messages and nothing is stored.",
        "A draft picture is served only to an active owner or admin by a no-store preview route; a public picture is served by the public media route with the verified content type, no sniffing, a long immutable cache and no token; draft, retired and unknown pictures are never served publicly and the routes reveal nothing about other pictures.",
        "Publishing a website revision marks exactly the pictures it uses as public in the same transaction that moves the live pointer, after checking each picture exists and is stored; a missing, retired or unknown picture blocks publishing with a plain message naming the field, and a repeat or stale publish never exposes extra pictures.",
        "Retiring a picture stops new selection but never deletes bytes that a kept or restorable revision uses, and a bounded maintenance step removes only old unreferenced draft uploads, never public or referenced pictures.",
        "When private picture storage is not configured the owner is told plainly what is missing (no purchase, no fallback to production storage), built-in pictures stay selectable, and a picture's description, decorative choice and focus point are stored with it and shown in a crop preview.",
        "The catalog photo setter now checks the signed-in owner or admin in the domain (not only in the form), accepts only an HTTPS address or a public website picture, and records the change in the activity log in the same transaction."
      ],
      "remainingEngineering": [
        "Asset table, image processing, storage interface, upload and serving routes, publish promotion, retire and cleanup, catalog setter, tests, docs"
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Gates and exclusions
No Stripe LIVE, customer email, SMS, spending or production storage. No paid ad purchase, no third-party tracking, no new provider account. sharp (the image library Next.js already installs) is declared as a direct dependency so image decoding does not depend on a hidden install; this is the one dependency change and no other library is added. Public pages still read plain text through the adapter; converting every page to typed content is V-C3, the owner editor is V-C4, redesign compatibility proof is V-C5, and the visual redesign V-1 to V-4 is later.
