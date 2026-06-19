// Extension IDs the dashboard attempts the session handoff against (AUTH-EXT-002,
// consumed by ExtensionLinkPage). The extension manifest carries no `key`, so the
// ID is not pinned: the published Chrome Web Store build uses the Google-assigned
// ID below, while unpacked dev builds get a path-derived ID per machine. The
// handoff loop tries each in order and stops at the first that responds, so
// listing extra dev IDs is harmless.
export const SPRINTBRAIN_EXTENSION_IDS = [
  'khdpimdpkgmmaimpbfjgglnpaemmopoo', // Chrome Web Store (published)
  'ngcgkbpekdallmninmclhopdmhkijidm', // unpacked / dev build
  'mfobnhbgijfiehjghhhdgendjpegmjge', // unpacked / dev build
] as const;
