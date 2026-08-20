---
name: PWA icon cache updates
description: How to make favicon and installed-app icon changes reach browsers reliably.
---

PWA install icons are independent assets from the browser-tab favicon. When the
brand icon changes, update the manifest `icons` entries, Apple touch icon, and
notification icon together. Give changed icon and manifest URLs a new version
or filename, and bump the service-worker cache version.

**Why:** Browsers, operating systems, manifests, and service workers cache
favicons and install icons independently. Replacing the bytes at an unchanged
URL can leave an old tab or install-preview icon visible long after the page
itself has refreshed.

**How to apply:** For a future icon refresh, generate correctly sized PNG
variants from the approved source artwork, use new filenames in both PWA
manifests, version the favicon and manifest link URLs, update notification
assets, and verify the production build emits each new icon before publishing.