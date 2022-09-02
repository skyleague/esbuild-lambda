import type { Plugin } from 'esbuild'

export const lambdaEntryPlugin: Plugin = {
    name: 'lambda-entry-loader',
    setup: (compiler) => {
        const filter = /.tsx?$/
        const namespace = 'lambda-entry'
        compiler.onResolve({ filter }, (args) => {
            if (args.kind === 'entry-point') {
                return { path: args.path, namespace }
            }
            return { path: args.path }
        })
        compiler.onLoad({ filter, namespace }, (args) => {
            return {
                contents: [
                    `try { require('source-map-support').install() } catch (err) {}`,
                    `export { handler } from '${args.path}'`,
                ].join('\n'),
                loader: 'ts',
            }
        })
    },
}
