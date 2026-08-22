const fs = require('fs');
const path = require('path');

const GUIDES = {
  unity: { engine: 'Unity', tool: 'Unity Hub and the Unity Editor', url: 'https://unity.com/download', docsUrl: 'https://docs.unity3d.com/Manual/GettingStarted.html', reason: 'Unity projects need the Unity Editor for scenes, assets, physics, builds, and play-mode testing.' },
  unreal: { engine: 'Unreal Engine', tool: 'Epic Games Launcher and Unreal Editor', url: 'https://www.unrealengine.com/download', docsUrl: 'https://dev.epicgames.com/documentation/en-us/unreal-engine/get-started', reason: 'Unreal projects need Unreal Editor for levels, Blueprints, assets, packaging, and engine debugging.' },
  godot: { engine: 'Godot', tool: 'Godot Editor', url: 'https://godotengine.org/download/', docsUrl: 'https://docs.godotengine.org/en/stable/getting_started/introduction/index.html', reason: 'Godot projects need the Godot Editor for scenes, nodes, resources, exports, and game debugging.' },
  gamemaker: { engine: 'GameMaker', tool: 'GameMaker IDE', url: 'https://gamemaker.io/en/download', docsUrl: 'https://manual.gamemaker.io/', reason: 'GameMaker projects rely on its IDE for rooms, objects, sprites, targets, and builds.' },
  roblox: { engine: 'Roblox', tool: 'Roblox Studio', url: 'https://create.roblox.com/docs/studio/setup', docsUrl: 'https://create.roblox.com/docs', reason: 'Roblox experiences must be played, simulated, published, and device-tested through Roblox Studio. Rojo can keep source code synchronized.' },
  defold: { engine: 'Defold', tool: 'Defold Editor', url: 'https://defold.com/download/', docsUrl: 'https://defold.com/manuals/introduction/', reason: 'Defold projects use its editor for collections, game objects, resources, bundling, and debugging.' },
  love2d: { engine: 'LÖVE', tool: 'LÖVE runtime', url: 'https://love2d.org/', docsUrl: 'https://love2d.org/wiki/Getting_Started', reason: 'LÖVE games need the LÖVE runtime for launching and game-loop testing.' },
  webgame: { engine: 'Web game framework', tool: 'the framework tooling and browser developer tools', url: 'https://developer.mozilla.org/en-US/docs/Games', docsUrl: 'https://developer.mozilla.org/en-US/docs/Games/Introduction', reason: 'Nexus can edit and run this code, while game-loop profiling, input, rendering, and asset workflows need game-focused browser tools and the framework documentation.' },
};

function exists(folder, relative) { return fs.existsSync(path.join(folder, relative)); }
function topLevelFiles(folder) { try { return fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name); } catch { return []; } }
function packageDependencies(folder) { try { const pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')); return new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).map((name) => name.toLowerCase())); } catch { return new Set(); } }
function result(type, evidence, confidence = 'high') { return { isGame: true, type, confidence, evidence, ...GUIDES[type] }; }

function detectGameProject(folder) {
  if (!folder || !fs.existsSync(folder)) return { isGame: false, confidence: 'none', evidence: [] };
  const files = topLevelFiles(folder);
  if (exists(folder, 'ProjectSettings/ProjectVersion.txt') && exists(folder, 'Assets')) return result('unity', ['ProjectSettings/ProjectVersion.txt', 'Assets/']);
  const unreal = files.find((file) => file.toLowerCase().endsWith('.uproject'));
  if (unreal) return result('unreal', [unreal]);
  if (exists(folder, 'project.godot')) return result('godot', ['project.godot']);
  const gameMaker = files.find((file) => file.toLowerCase().endsWith('.yyp'));
  if (gameMaker) return result('gamemaker', [gameMaker]);
  if (files.some((file) => /\.rbxlx?$/.test(file.toLowerCase()))) return result('roblox', [files.find((file) => /\.rbxlx?$/.test(file.toLowerCase()))]);
  if (exists(folder, 'default.project.json')) { try { const rojo = fs.readFileSync(path.join(folder, 'default.project.json'), 'utf8'); if (/\$className|ReplicatedStorage|ServerScriptService/.test(rojo)) return result('roblox', ['default.project.json (Rojo project)']); } catch {} }
  if (exists(folder, 'game.project')) return result('defold', ['game.project']);
  if (exists(folder, 'conf.lua') && exists(folder, 'main.lua')) return result('love2d', ['conf.lua', 'main.lua']);
  const dependencies = packageDependencies(folder);
  const frameworks = ['phaser', 'playcanvas', 'excalibur', 'melonjs', 'kaboom', 'cocos-creator'];
  const framework = frameworks.find((name) => dependencies.has(name));
  if (framework) return result('webgame', [`package.json dependency: ${framework}`]);
  return { isGame: false, confidence: 'none', evidence: [] };
}

module.exports = { GUIDES, detectGameProject };
