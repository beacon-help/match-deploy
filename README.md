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

## Deploying

```shell
make deploy-stack            # dry run: checks only, nothing is deployed
make deploy-stack DEPLOY=1   # the same checks, then `cdk deploy`
```

The checks run in order and stop at the first failure: prerequisites, config,
release tag (must exist in both repos), AWS credentials (account must match `AWS_ACCOUNT_ID`), CDK bootstrap, EC2 key
pair, backend and frontend tests, synth, current stack state, and the diff
against what is deployed. Every AWS call in them is read-only.
`DEPLOY_ENV_FILE` points at an env file other than `.env`.

match-deploy decides the config version of everything it ships. The backend and
frontend are cloned at the release tag into `temp/release/`, their
`vendor/match-config` is checked out at this repo's pinned commit, and their
tests run against it: mypy and pytest for the backend, svelte-check and vitest
for the frontend. A repo pinned to a newer match-config than this one stops the
dry run, because that would be a downgrade. The tests need `uv` and `pnpm`, and
take about 1.5 minutes.

## Shared config (match-config)

`vendor/match-config` is a git submodule pinned to a tag. After a fresh clone:

```shell
git submodule update --init --recursive
npm install   # links and builds vendor/match-config/typescript
```

```ts
import { getConfig } from 'match-config';
```

Needs Node >= 22.12 (the package is ESM, loaded with `require()`). Local
overrides go in a gitignored `config.local.yaml`.

The `deploy` section holds the shared values: resource-name prefix (`name`), region,
release tag, backend and frontend repos, instance type and ports. `.env` keeps only
the private ones: `AWS_ACCOUNT_ID` and `AWS_KEY_PAIR`.

`release_tag` is the git tag deployed from both repos, so tag the backend and
frontend with the same name. To deploy a tag before it is set in match-config,
put it in `config.local.yaml`:

```yaml
deploy:
  release_tag: v1.0.0
```
