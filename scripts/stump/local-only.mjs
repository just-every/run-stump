// STUMP_NETWORK_EDGE routes every outbound network request to a local fake
// (src/stump/net/fetch.ts). It belongs only in a local runtime's .dev.vars:
// a production build refuses it, as rer build and rer deploy refuse RER_DEV_KEY.
// rer deploy also refuses it through the adapter's localOnlyKeys.
export const LOCAL_ONLY = ['STUMP_NETWORK_EDGE'];

function carried(vars) {
 return vars && typeof vars === 'object' ? LOCAL_ONLY.find(name => Object.hasOwn(vars, name)) : undefined;
}

export function refuseLocalOnly() {
 return {
  name: 'stump:refuse-local-only',
  apply: 'build',
  buildStart() {
   const name = LOCAL_ONLY.find(key => process.env[key] !== undefined);
   if (name) this.error(`${name} is local-only and a build never carries it. Unset it in this environment, keep it in .dev.vars for rer dev, and build again.`);
  },
  generateBundle(_options, bundle) {
   for (const [fileName, output] of Object.entries(bundle)) {
    if (!/(?:^|\/)wrangler\.json$/.test(fileName) || output.type !== 'asset') continue;
    const name = carried(JSON.parse(String(output.source)).vars);
    if (name) this.error(`The Worker configuration binds ${name}, which is local-only. Remove it from wrangler.jsonc vars and build again.`);
   }
  },
 };
}
