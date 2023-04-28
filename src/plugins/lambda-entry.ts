import type { Plugin } from 'esbuild'

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
export const lambdaEntryPlugin: (features: { sourceMapSupport?: boolean; xray?: boolean; esm: boolean }) => Plugin = (
    features
) => ({
    name: 'lambda-entry-loader',
    setup: (compiler) => {
        const filter = /\.tsx?$/
        const namespace = 'lambda-entry'
        compiler.onResolve({ filter }, (args) => {
            if (args.kind === 'entry-point') {
                return { path: args.path, namespace }
            }
            return { path: require.resolve(args.path, { paths: [args.resolveDir] }) }
        })
        compiler.onLoad({ filter, namespace }, (args) => {
            const load = features.esm ? 'await import' : 'require'
            return {
                contents: [
                    ...(features.xray ?? true
                        ? [
                              // Before doing anything, attempt to initiate the HTTPs capture
                              `try { new (${load}('@aws-lambda-powertools/tracer')).Tracer({ captureHTTPsRequests: true }) } catch (err) {}`,
                          ]
                        : []),
                    ...(features.sourceMapSupport ?? true
                        ? [`try { (${load}('source-map-support')).install() } catch (err) {}`]
                        : []),
                    `export { handler } from '${args.path.replaceAll('\\', '\\\\')}'`,
                ].join('\n'),
                loader: 'ts',
            }
        })
    },
})
