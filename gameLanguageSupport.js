(function exposeGameLanguageSupport(root, factory) {
  const support = factory();
  if (typeof module === 'object' && module.exports) module.exports = support;
  if (root) root.nexusGameLanguageSupport = support;
}(typeof window !== 'undefined' ? window : globalThis, () => {
  const languages = Object.freeze([
    { name:'GameMaker Language', extensions:['.gml'], color:'#71b417', editorMode:'text/x-csrc', checker:'gamemaker' },
    { name:'GDScript', extensions:['.gd'], color:'#355570', editorMode:'python', checker:'gdscript' },
    { name:'Godot Shader', extensions:['.gdshader'], color:'#478cbf', editorMode:'text/x-c++src', checker:'game-shader' },
    { name:'HLSL', extensions:['.hlsl','.fx','.fxh','.compute'], color:'#aace60', editorMode:'text/x-c++src', checker:'game-shader' },
    { name:'GLSL', extensions:['.glsl','.vert','.frag','.geom','.tesc','.tese','.comp'], color:'#5686a5', editorMode:'text/x-c++src', checker:'game-shader' },
    { name:'ShaderLab', extensions:['.shader'], color:'#222c37', editorMode:'text/x-c++src', checker:'game-shader' },
  ]);

  const byExtension = Object.freeze(Object.fromEntries(
    languages.flatMap((language) => language.extensions.map((extension) => [extension, language])),
  ));

  function extensionFor(filename) {
    const lower = String(filename || '').toLowerCase();
    return Object.keys(byExtension).sort((a, b) => b.length - a.length).find((extension) => lower.endsWith(extension)) || '';
  }

  function languageFor(filename) { return byExtension[extensionFor(filename)] || null; }
  function editorModeFor(filename) { return languageFor(filename)?.editorMode || null; }

  return Object.freeze({ languages, byExtension, extensionFor, languageFor, editorModeFor });
}));
