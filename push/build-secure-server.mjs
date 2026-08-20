import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'server.ts');
const outputPath = path.join(root, 'server.secure.generated.ts');

let source = fs.readFileSync(sourcePath, 'utf8');
// Normalize to LF before any exact-text matching below. Windows git checkouts
// often auto-convert LF to CRLF on clone (core.autocrlf); without this, every
// replaceRequired() call below silently fails to match even text that looks
// character-for-character identical on screen.
source = source.replace(/\r\n/g, '\n');

function replaceRequired(input, needle, replacement, label) {
  if (!input.includes(needle)) throw new Error(`[secure-server] Required source pattern not found: ${label}`);
  return input.replace(needle, replacement);
}

source = replaceRequired(
  source,
  "import { requireAuth, AuthenticatedRequest } from './server/authMiddleware';",
  "import { requireAuth, AuthenticatedRequest } from './server/authMiddleware';\nimport { adminRolesRouter } from './server/adminRoles';",
  'secure auth imports',
);

source = replaceRequired(
  source,
  "app.use(express.json({ limit: '10mb' }));",
  `app.use(express.json({ limit: '10mb' }));

// Production authorization routes: Firebase token + server-side role claims.
app.use('/api/admin', adminRolesRouter);

// Phase-0 trust firewall. These legacy routes used simulated/global state,
// client-supplied account identity, or unverified seeded knowledge. The trusted
// client no longer depends on them; keep them unavailable until replaced by a
// source-backed implementation.
const disabledLegacyPrefixes = [
  '/api/master-version',
  '/api/master/generate-code-patch',
  '/api/cook-logs',
  '/sync/hours',
  '/api/sync/hours',
  '/api/v1/smoker/sync',
  '/smoker/sync',
  '/api/federated-learning',
  '/api/smoker-database',
  '/api/custom-smokers',
  '/api/manufacturer-smokers',
  '/api/verified-cuts',
  '/api/togrill',
  '/api/alexa',
  '/api/push/send-alert',
  '/api/analyze-cook-graph',
  '/api/chargpt/analyze-meat-photo',
  '/api/chargpt/identify-unknown-cut',
  '/api/chargpt/verify-cut-online',
  '/api/chargpt/optimize-blend',
  '/api/chargpt/pitmaster-courses',
];
app.use((req, res, next) => {
  if (disabledLegacyPrefixes.some((prefix) => req.path === prefix || req.path.startsWith(prefix + '/'))) {
    return res.status(503).json({
      success: false,
      error: 'This legacy integration is disabled in the trusted runtime until a verified implementation is available.',
      integrationStatus: 'unavailable',
    });
  }
  next();
});`,
  'admin router and phase0 trust firewall',
);

// CharGPT must never fabricate an offline answer or claim a memory update when
// the model call failed. Replace the legacy fallback and catch behavior.
const charFallback = source.indexOf('    // Fallback response for offline or unauthenticated mode');
const charCatch = source.indexOf('  } catch (err: any) {', charFallback);
if (charFallback < 0 || charCatch < 0) throw new Error('[secure-server] CharGPT fallback boundary not found.');
source = source.slice(0, charFallback) + `    return res.status(503).json({\n      error: 'CharGPT is temporarily unavailable. No AI response or memory update was generated.',\n      availability: 'unavailable',\n    });\n` + source.slice(charCatch);

const oldCatch = `  } catch (err: any) {\n    console.error('Error in CharGPT endpoint:', err);\n    return res.status(200).json({\n      text: \`🔎 CharGPT Recipe & Technique Guide:\n• Maintain 225°F - 250°F smoker temperature.\n• Use 16-mesh black pepper and coarse kosher salt for a clean bark.\n• Wrap at 160°F - 165°F stall to protect moisture.\n• Rest minimum 45 minutes in a warm cooler.\`,\n      groundingChunks: [],\n      searchEntryPoint: '',\n    });\n  }`;
const newCatch = `  } catch (err: any) {\n    console.error('Error in CharGPT endpoint:', err);\n    return res.status(503).json({\n      error: 'CharGPT request failed. No fallback cooking advice was fabricated.',\n      availability: 'error',\n    });\n  }`;
source = replaceRequired(source, oldCatch, newCatch, 'truthful CharGPT error handling');

fs.writeFileSync(outputPath, source, 'utf8');
console.log(`[secure-server] Generated ${path.relative(root, outputPath)}`);
console.log('[secure-server] Verified: OWNER auth, unverified/simulated legacy routes disabled, no fake code deployment, truthful CharGPT failures.');
