// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// expo-sqlite runs on wasm in the browser, so Metro has to treat .wasm as an
// asset rather than trying to resolve it as a module. Without this, any web
// bundle fails on `wa-sqlite.wasm`. Native builds are unaffected.
config.resolver.assetExts.push('wasm');

// The wasm build needs SharedArrayBuffer, which browsers only expose to
// cross-origin-isolated pages. In production these headers have to come from
// whatever serves the site (see the expo-router `headers` plugin option).
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  return middleware(req, res, next);
};

module.exports = config;
