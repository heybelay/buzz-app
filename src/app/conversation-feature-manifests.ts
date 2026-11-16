import type { PluginManifest } from "../plugins/api";
import emojiManifest from "../bundled/emoji/manifest.json";
import mentionsManifest from "../bundled/mentions/manifest.json";
import { PLUGIN_REQUEST_REVIEWER } from "../plugins/review-access";

// The host-owned features, listed once. `conversation-features` pairs each
// with its module; this file imports none, so reading a name loads no feature.
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
