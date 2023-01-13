import type { Plugin } from 'esbuild'

export const lambdaEntryPlugin: (features?: { sourceMapSupport?: boolean; xray?: boolean }) => Plugin = (
    features = { xray: true, sourceMapSupport: true }
) => ({
    name: 'lambda-entry-loader',
    setup: (compiler) => {
        const filter = /.tsx?$/
        const namespace = 'lambda-entry'
        compiler.onResolve({ filter }, (args) => {
            if (args.kind === 'entry-point') {
                return { path: args.path, namespace }
            }
            return { path: require.resolve(args.path, { paths: [args.resolveDir] }) }
        })
        compiler.onLoad({ filter, namespace }, (args) => {
            return {
                contents: [
                    ...(features?.xray ?? true
                        ? [
                              // Before doing anything, attempt to initiate the HTTPs capture
                              `try { new require('@aws-lambda-powertools/tracer').Tracer({ captureHTTPsRequests: true }) } catch (err) {}`,
                          ]
                        : []),
                    ...(features?.sourceMapSupport ?? true
                        ? [`try { require('source-map-support').install() } catch (err) {}`]
                        : []),
                    `export { handler } from '${args.path}'`,
                ].join('\n'),
                loader: 'ts',
            }
        })
    },
})
