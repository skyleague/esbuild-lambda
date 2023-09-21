import { getImportPath } from '../plugins/index.js'

import { asyncCollect, parallelLimit } from '@skyleague/axioms'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

interface Options {
    fileName: string
    isHandler: (mod: {}) => boolean
}

const pLimit = parallelLimit(Math.max(os.cpus().length, 2))
export async function* listLambdaHandlersGenerator(
    dir: string,
    { fileName = 'index.ts', isHandler = (mod) => Object.keys(mod).includes('handler') }: Partial<Options> = {}
): AsyncGenerator<string, void> {
    const subs = await Promise.all(
        (
            await fs.promises.readdir(dir)
        )
            .filter((sub) => !sub.startsWith('.'))
            .map((sub) => path.join(dir, sub))
            .map(async (sub) => ({ sub, stat: await pLimit(() => fs.promises.stat(sub)) }))
    )
    const index = subs.find((s) => s.sub.endsWith(`${path.sep}${fileName}`))
    if (index !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        if (isHandler(await import(getImportPath(index.sub.replace(/\.ts$/g, '.js'))))) {
            yield dir
        }
    }
    for (const sub of subs.filter((s) => s.stat.isDirectory())) {
        yield* listLambdaHandlersGenerator(sub.sub, { fileName, isHandler })
    }
}

export async function listLambdaHandlers(dir: string, options: Partial<Options> = {}): Promise<string[]> {
    return asyncCollect(listLambdaHandlersGenerator(dir, options))
}
