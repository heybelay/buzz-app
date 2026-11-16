import type { PluginModule } from "../plugins/api";
import type { BundledPlugin } from "../plugins/manager";
import * as emoji from "../bundled/emoji";
import * as mentions from "../bundled/mentions";
import { conversationFeatureManifests } from "./conversation-feature-manifests";
import * as pluginRequests from "./plugin-request-feature";

type Feature = keyof typeof conversationFeatureManifests;
// A manifest without a module, or a module without a manifest, fails to compile.
const modules: Record<Feature, PluginModule> = {
  emoji,
  mentions,
  pluginRequests,
};

// Host-owned features use the shared contribution lifecycle, without catalog
// entries or saved enablement. Keep their keys for composer and huddle consumers.
// Add a feature in `conversation-feature-manifests`, not here: a Rust test reads
// both files as text to match the native reserved ids (see the note there).
export const conversationFeatures: readonly BundledPlugin[] = (
  Object.keys(conversationFeatureManifests) as Feature[]
).map((feature) => ({
  manifest: conversationFeatureManifests[feature],
  module: modules[feature],
}));
