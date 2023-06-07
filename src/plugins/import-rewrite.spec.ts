import { setupImportRewriteOnLoad } from './import-rewrite.js'

import { alphaNumeric, array, asyncForAll, constants, object, oneOf, string, tuple } from '@skyleague/axioms'
import type { OnLoadArgs } from 'esbuild'
import { describe, it, expect, vi } from 'vitest'

describe('onLoad', () => {
    const _fs = { promises: { readFile: vi.fn() } }
    const onLoad = setupImportRewriteOnLoad('lodash', 'lodash', _fs)

    it('should return void if no lodash imports are found', async () => {
        await asyncForAll(tuple(alphaNumeric({ minLength: 1 }), string()), async ([fileName, contents]) => {
            _fs.promises.readFile.mockReset()
            _fs.promises.readFile.mockResolvedValueOnce(contents)
            expect(
                await onLoad({
                    path: `./${fileName}.ts`,
                } as OnLoadArgs)
            ).toEqual(undefined)
            expect(_fs.promises.readFile).toHaveBeenCalledTimes(1)
            expect(_fs.promises.readFile).toHaveBeenCalledWith(`./${fileName}.ts`, 'utf8')
        })
    })

    it('should rewrite imports from lodash', async () => {
        const whitespace = ({ minLength = 0, maxLength = 10 } = {}) =>
            array(constants(' ', '\n', '\t', '\r\n'), { minLength, maxLength }).map((cs) => cs.join(''))
        await asyncForAll(
            tuple(
                alphaNumeric(),

                object({
                    preCurly: whitespace({ minLength: 1 }),
                    postCurly: whitespace({ minLength: 1 }),
                    postFrom: whitespace(),
                    quote: constants("'", '"'),
                    imports: array(
                        tuple(whitespace(), alphaNumeric({ minLength: 1 }), whitespace()).map((xs) => xs.join('')),
                        { minLength: 1 }
                    ),
                    lineEnd: oneOf(whitespace(), constants(';')),
                    preImportLine: string(),
                    postImportLine: string(),
                }).map(({ preCurly, postCurly, postFrom, quote, imports, lineEnd, preImportLine, postImportLine }) => {
                    const contents = [
                        preImportLine,
                        `import${preCurly}{${imports.join(',')}}${postCurly}from${postFrom}${quote}lodash${quote}${lineEnd}`,
                        postImportLine,
                    ].join('\n')
                    return {
                        contents,
                        preCurly,
                        postCurly,
                        lineEnd,
                        preImportLine,
                        postImportLine,
                        imports,
                    }
                })
            ),
            async ([fileName, { contents, preImportLine, postImportLine, imports }]) => {
                _fs.promises.readFile.mockReset()
                _fs.promises.readFile.mockResolvedValueOnce(contents)
                const result = await onLoad({
                    path: `./${fileName}.ts`,
                } as OnLoadArgs)
                expect(result?.loader).toEqual('ts')
                for (const i of imports) {
                    expect(result?.contents?.toString()).toContain(`import ${i.trim()} from 'lodash/${i.trim()}';`)
                }
                expect(result?.contents?.toString().startsWith(preImportLine)).toEqual(true)
                expect(result?.contents?.toString().endsWith(postImportLine)).toEqual(true)
                expect(_fs.promises.readFile).toHaveBeenCalledTimes(1)
                expect(_fs.promises.readFile).toHaveBeenCalledWith(`./${fileName}.ts`, 'utf8')
            }
        )
    })

    it('should rewrite requires from lodash', async () => {
        const whitespace = ({ minLength = 0, maxLength = 10 } = {}) =>
            array(constants(' ', '\n', '\t', '\r\n'), { minLength, maxLength }).map((cs) => cs.join(''))
        await asyncForAll(
            tuple(
                alphaNumeric(),

                object({
                    preCurly: whitespace({ minLength: 1 }),
                    postCurly: whitespace({ minLength: 1 }),
                    preRequire: whitespace(),
                    postRequire: whitespace(),
                    requirePadding: whitespace(),
                    quote: constants("'", '"'),
                    imports: array(
                        tuple(whitespace(), alphaNumeric({ minLength: 1 }), whitespace()).map((xs) => xs.join('')),
                        { minLength: 1 }
                    ),
                    lineEnd: oneOf(whitespace(), constants(';')),
                    preImportLine: string(),
                    postImportLine: string(),
                }).map(
                    ({
                        preCurly,
                        postCurly,
                        preRequire,
                        postRequire,
                        requirePadding,
                        quote,
                        imports,
                        lineEnd,
                        preImportLine,
                        postImportLine,
                    }) => {
                        const contents = [
                            preImportLine,
                            `const${preCurly}{${imports.join(
                                ','
                            )}}${postCurly}=${preRequire}require${postRequire}(${requirePadding}${quote}lodash${quote}${requirePadding})${lineEnd}`,
                            postImportLine,
                        ].join('\n')
                        return {
                            contents,
                            preCurly,
                            postCurly,
                            lineEnd,
                            preImportLine,
                            postImportLine,
                            imports,
                        }
                    }
                )
            ),
            async ([fileName, { contents, preImportLine, postImportLine, imports }]) => {
                _fs.promises.readFile.mockReset()
                _fs.promises.readFile.mockResolvedValueOnce(contents)
                const result = await onLoad({
                    path: `./${fileName}.ts`,
                } as OnLoadArgs)
                expect(result?.loader).toEqual('ts')
                for (const i of imports) {
                    expect(result?.contents?.toString()).toContain(`const ${i.trim()} = require('lodash/${i.trim()}');`)
                }
                expect(result?.contents?.toString().startsWith(preImportLine)).toEqual(true)
                expect(result?.contents?.toString().endsWith(postImportLine)).toEqual(true)
                expect(_fs.promises.readFile).toHaveBeenCalledTimes(1)
                expect(_fs.promises.readFile).toHaveBeenCalledWith(`./${fileName}.ts`, 'utf8')
            }
        )
    })
})
