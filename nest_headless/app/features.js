'use strict';
const fs = require('node:fs');
const path = require('node:path');
const features = {};
for (const [name, dependencies] of Object.entries({ vision: ['onnxruntime-node', 'sharp'], speech: ['sherpa-onnx-node'] })) {
  const requested = process.env['ENABLE_' + name.toUpperCase()] === 'true';
  features[name] = { requested, enabled: false };
  if (!requested) continue;
  try {
    // The launcher records failed upgrades too: do not accidentally load an old
    // cached pack after its replacement failed to install.
    if (process.env.FEATURE_DATA_DIR) {
      const status = JSON.parse(fs.readFileSync(path.join(process.env.FEATURE_DATA_DIR, 'status.json'), 'utf8'));
      if (!status[name]?.ready) throw new Error(status[name]?.error || 'dependencies not ready');
    }
    for (const dep of dependencies) require(dep);
    features[name].enabled = true;
  } catch (error) {
    features[name].error = error.message;
    console.warn(`[nest_headless] ${name} disabled: ${error.message}`);
  }
}
module.exports = features;
