const fs = require('fs');
const path = require('path');

// Official project toolchains. Frameworks belong here rather than in the
// language-server registry: a framework can add build/check commands without
// pretending to be a programming language.
const PLATFORMS = Object.freeze([
  { id:'angular', name:'Angular', vendor:'Google', kind:'web', markers:['angular.json'], packages:['@angular/core'], commands:{ develop:'npx ng serve', check:'npx ng build', test:'npx ng test' }, install:'Use the project-local @angular/cli and @angular/language-service packages.' },
  { id:'nuxt', name:'Nuxt', vendor:'NuxtLabs', kind:'web', markers:['nuxt.config.ts','nuxt.config.js'], packages:['nuxt'], commands:{ develop:'npm run dev', check:'npm run build', test:'npm test' } },
  { id:'astro', name:'Astro', vendor:'Astro Technology Company', kind:'web', markers:['astro.config.mjs','astro.config.ts','astro.config.js'], packages:['astro'], commands:{ develop:'npm run dev', check:'npx astro check', test:'npm test' } },
  { id:'remix', name:'Remix', vendor:'Shopify', kind:'web', markers:['remix.config.js','remix.config.mjs'], packages:['@remix-run/dev'], commands:{ develop:'npm run dev', check:'npm run typecheck', test:'npm test' } },
  { id:'qwik', name:'Qwik', vendor:'Builder.io', kind:'web', markers:['qwik.config.ts'], packages:['@builder.io/qwik'], commands:{ develop:'npm run dev', check:'npm run build', test:'npm test' } },
  { id:'solid', name:'SolidJS', vendor:'SolidJS', kind:'web', markers:['app.config.ts'], packages:['solid-js'], commands:{ develop:'npm run dev', check:'npm run build', test:'npm test' } },
  { id:'react-native', name:'React Native', vendor:'Meta', kind:'mobile', markers:['metro.config.js','metro.config.ts'], packages:['react-native'], commands:{ develop:'npm start', check:'npx react-native doctor', test:'npm test' }, external:'Android Studio is required for Android emulation; Xcode on macOS is required for iOS.' },
  { id:'flutter', name:'Flutter', vendor:'Google', kind:'mobile', markers:['pubspec.yaml'], contentMarker:{ file:'pubspec.yaml', pattern:/\bflutter\s*:/ }, commands:{ develop:'flutter run', check:'flutter analyze', test:'flutter test' }, external:'Install the official Flutter SDK. Android Studio is used for Android devices; Xcode is required for iOS.' },
  { id:'android', name:'Native Android', vendor:'Google', kind:'mobile', markers:['settings.gradle','settings.gradle.kts','AndroidManifest.xml'], commands:{ check:'gradlew.bat lint', test:'gradlew.bat test' }, external:'Android Studio and the Android SDK provide the official emulator, debugger, signing, and packaging workflow.' },
  { id:'apple-native', name:'Native Apple (iOS, macOS, SwiftUI)', vendor:'Apple', kind:'apple', suffixMarkers:['.xcodeproj','.xcworkspace'], markers:['Package.swift'], commands:{ check:'swift build', test:'swift test' }, external:'Building, signing, simulating, and publishing Apple apps requires macOS and Xcode.' },
  { id:'dotnet-maui', name:'.NET MAUI', vendor:'Microsoft', kind:'desktop-mobile', projectPattern:/<UseMaui>true<\/UseMaui>/i, commands:{ check:'dotnet build', test:'dotnet test' }, external:'Install the official .NET SDK and MAUI workload.' },
  { id:'wpf', name:'WPF', vendor:'Microsoft', kind:'desktop', projectPattern:/<UseWPF>true<\/UseWPF>/i, commands:{ check:'dotnet build', test:'dotnet test' }, external:'Windows and the official .NET SDK are required.' },
  { id:'winui', name:'WinUI', vendor:'Microsoft', kind:'desktop', packages:['Microsoft.WindowsAppSDK'], projectPattern:/Microsoft\.WindowsAppSDK/i, commands:{ check:'dotnet build', test:'dotnet test' }, external:'Windows App SDK and Visual Studio Build Tools may be required.' },
  { id:'tauri', name:'Tauri', vendor:'Tauri Programme', kind:'desktop', markers:['src-tauri/tauri.conf.json','src-tauri/tauri.conf.json5'], packages:['@tauri-apps/api'], commands:{ develop:'npm run tauri dev', check:'npm run tauri build', test:'cargo test' }, external:'Install Rust and the platform prerequisites documented by Tauri.' },
  { id:'wordpress', name:'WordPress', vendor:'WordPress Foundation', kind:'cms', markers:['wp-config.php','wp-content'], contentMarker:{ file:'style.css', pattern:/Theme Name\s*:/i }, commands:{ check:'wp core verify-checksums', test:'composer test' }, external:'Use the official WP-CLI and a local PHP/database environment.' },
  { id:'drupal', name:'Drupal', vendor:'Drupal Association', kind:'cms', markers:['core/lib/Drupal.php','web/core/lib/Drupal.php'], packages:['drupal/core'], commands:{ check:'composer validate', test:'vendor/bin/phpunit' }, external:'Use Composer, PHP, and Drush for the complete local workflow.' },
  { id:'shopify', name:'Shopify theme/app', vendor:'Shopify', kind:'commerce', markers:['shopify.app.toml','shopify.theme.toml'], packages:['@shopify/cli','@shopify/shopify-app-remix'], commands:{ develop:'shopify app dev', check:'shopify app build', test:'npm test' }, external:'Install the official Shopify CLI and sign in to a Shopify development store.' },
]);

function readPackage(folder) {
  try { return JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')); } catch { return {}; }
}
function filesAt(folder) {
  try { return fs.readdirSync(folder, { withFileTypes:true }).map((entry) => entry.name); } catch { return []; }
}
function hasMarker(folder, marker) { return fs.existsSync(path.join(folder, ...marker.split('/'))); }
function projectFiles(folder) {
  return filesAt(folder).filter((name) => /\.(?:csproj|fsproj|vbproj)$/i.test(name)).map((name) => {
    try { return fs.readFileSync(path.join(folder, name), 'utf8'); } catch { return ''; }
  });
}
function detectOfficialPlatforms(folder) {
  const pkg = readPackage(folder); const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const rootNames = filesAt(folder); const dotnetFiles = projectFiles(folder);
  return PLATFORMS.filter((platform) => {
    if (platform.markers?.some((marker) => hasMarker(folder, marker))) {
      if (!platform.contentMarker) return true;
      try { return platform.contentMarker.pattern.test(fs.readFileSync(path.join(folder, platform.contentMarker.file), 'utf8')); } catch { return false; }
    }
    if (platform.suffixMarkers?.some((suffix) => rootNames.some((name) => name.endsWith(suffix)))) return true;
    if (platform.packages?.some((name) => dependencies[name])) return true;
    return platform.projectPattern ? dotnetFiles.some((content) => platform.projectPattern.test(content)) : false;
  }).map((platform) => ({ ...platform, detected:true }));
}

module.exports = { PLATFORMS, detectOfficialPlatforms };
