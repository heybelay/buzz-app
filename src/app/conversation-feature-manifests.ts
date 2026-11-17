import type { PluginManifest } from "../plugins/api";
import emojiManifest from "../bundled/emoji/manifest.json";
import mentionsManifest from "../bundled/mentions/manifest.json";
import { PLUGIN_REQUEST_REVIEWER } from "../plugins/review-access";

// The host-owned features, listed once. `conversation-features` pairs each
// with its module; this file imports none, so reading a name loads no feature.
//
// The native plugin manager reserves these ids. Its Rust test
// `native_catalog_matches_desktop_bundles` (crates/plugin-manager/src/lib.rs)
// reads this file as text to check that the two lists match. It takes a
// feature's id from each bundled manifest imported here by its path, as the
// two above are, however the entry that uses it is written, and from each
// `id: CONSTANT,` line whose constant is declared in `plugins/review-access`.
// An id that arrives another way escapes the check: a string literal, a
// constant declared elsewhere, or a manifest reached through another module.
export const conversationFeatureManifests = {
  emoji: { ...emojiManifest, apiVersion: 1 },
  mentions: { ...mentionsManifest, apiVersion: 1 },
  pluginRequests: {
    id: PLUGIN_REQUEST_REVIEWER,
    name: "Plugin requests",
    apiVersion: 1,
    description: "Review agents' plugin requests in their conversations.",
  },
} satisfies Record<string, PluginManifest>;
