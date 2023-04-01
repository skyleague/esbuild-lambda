# ESBuild Lambda _(@skyleague/esbuild-lambda)_

This tool provides a simple means of building artifacts that are packageable for deployment to AWS Lambda. It works together well with the [`@skyleague/aws-lambda`](https://github.com/skyleague/aws-lambda) module for Terraform.

## Background

After years of working with a hybrid toolchain of Terraform and the [Serverless Framework](https://www.serverless.com/) on the AWS cloud, we felt the need for an agnostic tool for packaging AWS Lambda, that could work with both deployment frameworks. Some projects rely heavily on Terraform, with only a single/few Lambda functions, whereas other projects might opt for a hybrid strategy of deploying "persistent" infra like S3/DynamoDB with the use of standardized Terraform modules, and subsequently deploying the runtime application with the Serverless Framework.

Being able to leverage the same build tool for both types of Lambda deployments helps in unifying the toolchain, making it easy to choose the right type of deployment that best fits the project.

## Install

Install `esbuild-lambda` using [`npm`](https://www.npmjs.com/):

```console
 $ npm install --save-dev @skyleague/esbuild-lambda
```

## Usage

Let's get started with a simple example:

```ts
// esbuild.config.ts
import { listLambdaHandlers, esbuildLambda } from '@skyleague/esbuild-lambda'

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
    const handlers = await listLambdaHandlers(path.join(__dirname, 'src', 'functions'))
    await Promise.all(handlers.map((fnDir) => esbuildLambda(fnDir, { root: __dirname })))
}
main().catch((err) => {
    console.error(err)
    process.exit(1)
})
```

Then add the following script to the `package.json` section for `scripts`:

```json
// package.json
{
    "scripts": {
        // add this
        "build": "npx ts-node esbuild.config.ts"
    }
}
```

Finally, run the build script using `npm`:

```console
$ npm run build
```

In this basic configuration, the `listLambdaHandlers` will search for all the `index.ts` files with an exported `handler` function, in the provided directory. Then `esbuildLambda` will run `esbuild` on each of those handlers, producing a `.build/artifacts` folder right next to the `index.ts`, containing the compiled Typescript handler, as well as a cherry-picked `package.json` with only the dependencies that are actually encountered in the require/import-chain of the `index.ts`. The `package-lock.json` will be copied over from the root of the repository, and the cherry-picked `package.json` will be installed in the artifact directory using `npm ci`.

This open source library package is part of the SkyLeague modern application delivery stack.

## Support

SkyLeague provides Enterprise Support on this open-source library package at clients across industries. Please get in touch via [`https://skyleague.io`](https://skyleague.io).

If you are not under Enterprise Support, feel free to raise an issue and we'll take a look at it on a best-effort basis!

## License & Copyright

This library is licensed under the MIT License (see [LICENSE.md](./LICENSE.md) for details).

If you using this SDK without Enterprise Support, please note this (partial) MIT license clause:

> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND

Copyright (c) 2022, SkyLeague Technologies B.V.. 'SkyLeague' and the astronaut logo are trademarks of SkyLeague Technologies, registered at Chamber of Commerce in The Netherlands under number 86650564.

All product names, logos, brands, trademarks and registered trademarks are property of their respective owners. All company, product and service names used in this website are for identification purposes only. Use of these names, trademarks and brands does not imply endorsement.
