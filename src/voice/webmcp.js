// Native capability is captured before registration. This module never installs a shim.
export async function registerNativeTools({ document: doc = globalThis.document, navigator: nav = globalThis.navigator, tools, runTool, onStatus = () => {} }) {
  const controller = new AbortController();
  const model = doc?.modelContext || nav?.modelContext;
  const source = doc?.modelContext ? 'document.modelContext' : nav?.modelContext ? 'navigator.modelContext' : null;
  const nativeMethod = typeof model?.registerTool === 'function' && Function.prototype.toString.call(model.registerTool).includes('[native code]');
  const status = { state: model ? 'registering' : 'unavailable', source, provenance: model ? nativeMethod ? source.startsWith('document') ? 'browser-native' : 'browser-native-legacy' : 'unverified-implementation' : 'none', registered: [], failures: [], getToolsSupported: typeof model?.getTools === 'function', executeToolSupported: typeof model?.executeTool === 'function' };
  onStatus(structuredClone(status));
  if (!model || typeof model.registerTool !== 'function') return { status, destroy: () => controller.abort() };
  for (const tool of tools) {
    try {
      await model.registerTool({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations, execute: async (input, options = {}) => {
        if (controller.signal.aborted || options.signal?.aborted) return { ok: false, code: 'ABORTED', speak: 'Solicitud cancelada.' };
        return runTool(tool.name, input, { source: 'native-webmcp', signal: options.signal });
      } }, { signal: controller.signal });
      status.registered.push(tool.name);
    } catch (error) { status.failures.push({ name: tool.name, error: String(error?.name || 'Error'), message: String(error?.message || 'Registration failed').slice(0, 240) }); }
  }
  status.state = status.failures.length ? 'registration-failed' : nativeMethod ? source.startsWith('document') ? 'native-registered' : 'legacy-registered' : 'adapter-registered-unverified';
  onStatus(structuredClone(status));
  return {
    status,
    async getTools() { if (!status.getToolsSupported) return null; return model.getTools(); },
    destroy() { controller.abort(); status.state = 'disconnected'; onStatus(structuredClone(status)); }
  };
}
