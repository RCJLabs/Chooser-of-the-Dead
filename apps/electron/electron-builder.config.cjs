// Packages the Steam build (docs/tech-spec.md §62) beside the game's own build: STEAM_EDITION=full (the default) or
// demo, each its own Steam app. The Steamworks library goes in only if it's in steamworks_sdk/ here (never in git).
const { existsSync } = require('node:fs');

const edition = process.env.STEAM_EDITION === 'demo' ? 'demo' : 'full';
const demo = edition === 'demo';
const sdk = (dir) =>
  existsSync(`steamworks_sdk/redistributable_bin/${dir}`)
    ? [{ from: `steamworks_sdk/redistributable_bin/${dir}`, to: `steamworks_sdk/redistributable_bin/${dir}` }]
    : [];

module.exports = {
  appId: demo ? 'com.rcjlabs.chooseroftheslain.demo' : 'com.rcjlabs.chooseroftheslain',
  productName: demo ? 'Chooser of the Slain Demo' : 'Chooser of the Slain',
  executableName: demo ? 'chooser-of-the-slain-demo' : 'chooser-of-the-slain',
  copyright: 'Copyright © 2026 RCJLabs',
  icon: '../web/public/icons/icon-512.png',
  // Steam uploads the folder (steamcmd, docs/steam.md); nothing is published from here.
  publish: null,
  directories: { output: `../../dist/steam/${edition}` },
  files: ['dist/main.js', 'dist/preload.js', 'package.json'],
  extraResources: [{ from: `../../dist/electron-${edition}`, to: 'game' }],
  // Native parts can't load from inside the app's archive.
  asarUnpack: ['**/node_modules/koffi/**', '**/node_modules/@koromix/**', '**/node_modules/steamworks-ffi-node/**'],
  npmRebuild: false,
  electronLanguages: ['en-US'],
  // Steam ships a folder; it doesn't want installers.
  linux: { target: 'dir', category: 'Game', extraResources: sdk('linux64') },
  win: { target: 'dir', extraResources: sdk('win64') },
};
