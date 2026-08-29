const PLUGIN_NAME = 'The Crucible';
const VERSION = '1.0.0';

function action(id, label, description, command) {
  return { id, label, description, command };
}

register({
  onActivate() {
    nexus.emitTelemetry('crucible.plugin.activated', { version: VERSION });
  },

  onDeactivate() {
    nexus.emitTelemetry('crucible.plugin.deactivated', { version: VERSION });
  },

  slots: {
    'project-actions': async (payload = {}) => ({
      plugin: PLUGIN_NAME,
      version: VERSION,
      projectRoot: payload.projectRoot || null,
      actions: [
        action(
          'crucible-validate',
          'Validate with The Crucible',
          'Run the project through its configured Crucible validation and governance checks.',
          'npx the-crucible validate'
        ),
        action(
          'crucible-release-gate',
          'Run Crucible release gate',
          'Run the project release/stress gate before promotion or publication.',
          'npm run release:crucible'
        )
      ],
      note: 'Commands are intentionally returned as host actions; this plugin does not receive arbitrary shell execution rights.'
    }),

    'inspector-panel': async (payload = {}) => ({
      title: 'The Crucible',
      status: 'available',
      projectRoot: payload.projectRoot || null,
      checks: [
        { id: 'configuration', label: '.thecrucible.json', expected: 'project configuration' },
        { id: 'governance', label: 'governingDocuments/', expected: 'governance baseline when enabled' },
        { id: 'workflow', label: '.github/workflows/the-crucible.yml', expected: 'CI enforcement workflow when configured' }
      ],
      safety: 'The plugin is UI-only by design. Nexus remains responsible for approving and executing any requested host action.'
    }),

    'command-palette': async () => ({
      commands: [
        action('crucible.validate', 'Crucible: Validate project', 'Validate the active project with The Crucible.', 'npx the-crucible validate'),
        action('crucible.release', 'Crucible: Run release gate', 'Run the configured Crucible release gate.', 'npm run release:crucible'),
        action('crucible.inspect', 'Crucible: Inspect governance', 'Open the Crucible inspector panel.', null)
      ]
    })
  }
});
