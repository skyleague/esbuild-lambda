import { getImportPath } from '../plugins/index.js'

import { asyncCollect, parallelLimit } from '@skyleague/axioms'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const pLimit = parallelLimit(Math.max(os.cpus().length, 2))
export async function* listLambdaHandlersGenerator(dir: string): AsyncGenerator<string, void> {
    const subs = await Promise.all(
        (
            await fs.promises.readdir(dir)
        )
            .filter((sub) => !sub.startsWith('.'))
            .map((sub) => path.join(dir, sub))
            .map(async (sub) => ({ sub, stat: await pLimit(() => fs.promises.stat(sub)) }))
    )
    const index = subs.find((s) => s.sub.endsWith(`${path.sep}index.ts`))
    if (index !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        if (Object.keys(await import(getImportPath(index.sub.replace(/\.ts$/g, '.js')))).includes('handler')) {
            yield dir
        }
    }
    for (const sub of subs.filter((s) => s.stat.isDirectory())) {
        yield* listLambdaHandlersGenerator(sub.sub)
    }
}

export async function listLambdaHandlers(dir: string): Promise<string[]> {
    return asyncCollect(listLambdaHandlersGenerator(dir))
}
