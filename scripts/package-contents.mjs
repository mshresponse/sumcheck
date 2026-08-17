/**
 * What goes into the published extension.
 *
 * Shared by `package.mjs`, which zips it, and `check.mjs`, which verifies the
 * manifest's dependencies are all in here. They lived only in the packager
 * until `_locales/` was added to the manifest and not to this list: the build
 * passed every check and produced a zip Chrome refuses to install, because
 * `default_locale` without `_locales/` is a load error. One list, checked
 * against the manifest, is the fix for the whole class.
 */
export const INCLUDE = [
  'manifest.json',
  '_locales',
  'icons',
  'src',
  'vendor',
  // Apache 2.0 §4(a) and §4(d): a copy of the licence and a readable copy of
  // the NOTICE travel with any distribution of the work, and the packaged zip
  // is a distribution.
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
];

export const EXCLUDE = ['*.map', '*/.DS_Store', '.DS_Store', 'vendor/VERSIONS.json'];
