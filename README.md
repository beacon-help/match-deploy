# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## Shared config (match-config)

`vendor/match-config` is a git submodule pinned to a tag. After a fresh clone:

```shell
git submodule update --init --recursive
npm install   # links and builds vendor/match-config/typescript
```

```ts
import { getConfig } from 'match-config';
```

Needs Node >= 22.12 (the package is ESM, loaded with `require()`). `tsconfig.json`
maps `match-config` to its built types because this project uses classic
CommonJS module resolution. Local overrides go in a gitignored `config.local.yaml`.

The `deploy` section holds the shared values: resource-name prefix (`name`), region,
branch, backend repo, instance type and ports. `.env` keeps only the private ones:
`AWS_ACCOUNT_ID`, `AWS_KEY_PAIR`, `DOCKER_DIR`. `AWS_REGION`, `NAME` and
`GITHUB_BRANCH` are no longer read from it.
