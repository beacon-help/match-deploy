/**
 * Check everything a deploy needs, and deploy only when asked.
 *
 *   npx ts-node scripts/deploy.ts            dry run: checks only, nothing deployed
 *   npx ts-node scripts/deploy.ts --deploy   the same checks, then `cdk deploy`
 *
 * Every AWS call in the checks is read-only. `cdk diff` runs with
 * --no-change-set, because a change set is created with the deploy role.
 *
 * The backend and frontend are cloned at the release tag into temp/release/,
 * their match-config submodule is swapped for this repo's, and their tests run
 * against it: match-deploy decides the config version of everything it ships.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Config, ENV_FILE, getConfigFromFile } from '../lib/config';
import { STACK_NAME } from '../lib/match-cdk-stack';

const MIN_NODE = [22, 12];
const SUBMODULE = 'vendor/match-config';
const BOOTSTRAP_STACK = 'CDKToolkit';
const WORK_DIR = 'temp/release';
const FAILURE_LINES = 40;

// Variables that would steer the cloned repos' config away from their own defaults.
const LEAKY_ENV = ['ENV', 'MATCH_CONFIG_DIR', 'MATCH_CONFIG_LOCAL', 'DEPLOY_ENV_FILE', 'VIRTUAL_ENV'];

class StepError extends Error {}

interface RunOptions {
    /** Stream output instead of capturing it, for long or interactive commands. */
    inherit?: boolean;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}

function run(cmd: string, args: string[], options: RunOptions = {}): string {
    const result = spawnSync(cmd, args, {
        encoding: 'utf8',
        stdio: options.inherit ? 'inherit' : 'pipe',
        cwd: options.cwd,
        env: options.env,
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) {
        throw new StepError(`Could not start \`${cmd}\`: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().split('\n').slice(-FAILURE_LINES).join('\n');
        const where = options.cwd ? ` in ${options.cwd}` : '';
        throw new StepError(`\`${cmd} ${args.join(' ')}\`${where} exited with ${result.status}${output ? `:\n${output}` : ''}`);
    }
    return result.stdout ?? '';
}

const git = (args: string[], cwd?: string) => run('git', args, { cwd }).trim();

/** The last line of `output` matching `pattern`, without colour codes. */
function summary(output: string, pattern: RegExp): string {
    const lines = output.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((line) => line.trim());
    return lines.filter((line) => pattern.test(line)).pop() ?? 'passed';
}

function aws(config: Config, args: string[]): any {
    return JSON.parse(run('aws', [...args, '--region', config.aws_region, '--output', 'json']));
}

/** A stack's status, or null when it does not exist. */
function stackStatus(config: Config, stackName: string): string | null {
    try {
        return aws(config, ['cloudformation', 'describe-stacks', '--stack-name', stackName]).Stacks[0].StackStatus;
    } catch (error) {
        if (error instanceof StepError && error.message.includes('does not exist')) {
            return null;
        }
        throw error;
    }
}

/** The environment for the cloned repos' tests: ours, minus anything that points their config elsewhere. */
function testEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const name of LEAKY_ENV) {
        delete env[name];
    }
    return env;
}

const describe = (repoDir: string, commit: string) => git(['describe', '--tags', '--always', commit], repoDir);

/**
 * Clone `repo` at the release tag and swap its match-config for ours.
 *
 * The tag is checked out as refs/tags/<tag>, because a branch may share its name.
 */
function checkout(repo: string, tag: string, deployPin: string): string {
    const dir = path.join(WORK_DIR, path.basename(repo));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(WORK_DIR, { recursive: true });

    git(['clone', '--quiet', `https://github.com/${repo}.git`, dir]);
    git(['checkout', '--quiet', '--detach', `refs/tags/${tag}`], dir);
    git(['submodule', 'update', '--quiet', '--init', '--recursive'], dir);

    const submodule = path.join(dir, SUBMODULE);
    const ownPin = git(['rev-parse', `HEAD:${SUBMODULE}`], dir);
    const isAncestor = spawnSync('git', ['merge-base', '--is-ancestor', ownPin, deployPin], { cwd: submodule }).status;
    if (isAncestor !== 0) {
        throw new StepError(
            `${repo}@${tag} pins match-config ${describe(submodule, ownPin)}, which is newer than or diverged from ` +
            `match-deploy's ${describe(submodule, deployPin)}. Bump match-deploy's match-config first.`
        );
    }
    git(['checkout', '--quiet', '--detach', deployPin], submodule);

    const commit = git(['rev-parse', '--short', 'HEAD'], dir);
    const swap = ownPin === deployPin
        ? `match-config ${describe(submodule, deployPin)} (already pinned)`
        : `match-config ${describe(submodule, ownPin)} → ${describe(submodule, deployPin)}`;
    return `${repo}@${tag} (${commit}) in ${dir}, ${swap}`;
}

const deploy = process.argv.includes('--deploy');
let config: Config;
let deployPin: string;

const repoDir = (repo: string) => path.join(WORK_DIR, path.basename(repo));

const steps: [string, () => string][] = [
    ['Prerequisites', () => {
        const [major, minor] = process.versions.node.split('.').map(Number);
        if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
            throw new StepError(`Node ${process.versions.node} is too old: match-config needs >= ${MIN_NODE.join('.')}.`);
        }
        if (!fs.existsSync(path.join(SUBMODULE, 'config/default.yaml'))) {
            throw new StepError(`${SUBMODULE} is empty. Run \`git submodule update --init --recursive\`.`);
        }
        // The backend and frontend get match-config at this commit, so it has to be exactly what is committed.
        if (git(['status', '--porcelain'], SUBMODULE) !== '') {
            throw new StepError(`${SUBMODULE} has uncommitted changes. The release would test a different config than this repo reads.`);
        }
        deployPin = git(['rev-parse', 'HEAD'], SUBMODULE);
        if (!fs.existsSync(ENV_FILE)) {
            throw new StepError(`${ENV_FILE} is missing. It needs AWS_ACCOUNT_ID and AWS_KEY_PAIR.`);
        }
        return `Node ${process.versions.node}, match-config ${describe(SUBMODULE, deployPin)}, env file ${ENV_FILE}`;
    }],

    ['Config', () => {
        config = getConfigFromFile(ENV_FILE);
        return `${config.name} (ENV=${config.env}): account ${config.aws_account}, ${config.aws_region}, ${config.instance_type}`;
    }],

    ['Release tag', () => {
        const tag = config.release_tag;
        if (tag === null) {
            throw new StepError(
                'deploy.release_tag is not set. Tag the backend and frontend repos with the same name, ' +
                'then set it in match-config or in a local config.local.yaml.'
            );
        }
        const commits = [config.backend_repo, config.frontend_repo].map((repo) => {
            try {
                const lines = run('git', [
                    'ls-remote', '--exit-code', '--tags', `https://github.com/${repo}.git`,
                    `refs/tags/${tag}`, `refs/tags/${tag}^{}`,
                ]).trim().split('\n');
                // An annotated tag lists its own object first, then the commit it points at as `^{}`.
                const commit = (lines.find((line) => line.endsWith('^{}')) ?? lines[0]).slice(0, 7);
                return `${repo}@${commit}`;
            } catch (error) {
                throw new StepError(`Tag ${tag} not found in ${repo}.\n${(error as Error).message}`);
            }
        });
        return `${tag}: ${commits.join(', ')}`;
    }],

    ['AWS access', () => {
        const identity = aws(config, ['sts', 'get-caller-identity']);
        if (identity.Account !== config.aws_account) {
            throw new StepError(`Credentials are for account ${identity.Account}, the env file expects ${config.aws_account}.`);
        }
        return `Signed in as ${identity.Arn}`;
    }],

    ['CDK bootstrap', () => {
        const status = stackStatus(config, BOOTSTRAP_STACK);
        if (status === null) {
            throw new StepError(`${config.aws_region} is not bootstrapped. Run \`npx cdk bootstrap aws://${config.aws_account}/${config.aws_region}\`.`);
        }
        if (!status.endsWith('_COMPLETE') || status.includes('ROLLBACK')) {
            throw new StepError(`${BOOTSTRAP_STACK} is in state ${status}.`);
        }
        return `${BOOTSTRAP_STACK} ${status}`;
    }],

    ['EC2 key pair', () => {
        try {
            aws(config, ['ec2', 'describe-key-pairs', '--key-names', config.aws_key_pair]);
        } catch (error) {
            throw new StepError(`Key pair ${config.aws_key_pair} not found in ${config.aws_region}.\n${(error as Error).message}`);
        }
        return `${config.aws_key_pair} exists`;
    }],

    ['Backend checkout', () => checkout(config.backend_repo, config.release_tag!, deployPin)],

    ['Backend tests', () => {
        const cwd = repoDir(config.backend_repo);
        const env = testEnv();
        // The backend's CI does the same: its tests read secrets from dotenv/.env.
        fs.copyFileSync(path.join(cwd, 'dotenv/.env.test'), path.join(cwd, 'dotenv/.env'));
        // --locked fails if match-config's dependencies no longer match the backend's uv.lock.
        run('uv', ['sync', '--locked', '--quiet'], { cwd, env });
        const mypy = run('uv', ['run', '--locked', 'mypy', './match', './scripts'], { cwd, env });
        const pytest = run('uv', ['run', '--locked', 'pytest', '-q'], { cwd, env });
        return `mypy: ${summary(mypy, /^Success/)}\n  ✓ pytest: ${summary(pytest, /passed|failed/)}`;
    }],

    ['Frontend checkout', () => checkout(config.frontend_repo, config.release_tag!, deployPin)],

    ['Frontend tests', () => {
        const cwd = repoDir(config.frontend_repo);
        const env = testEnv();
        // --frozen-lockfile fails if match-config's dependencies no longer match the frontend's lockfile.
        run('pnpm', ['install', '--frozen-lockfile'], { cwd, env });
        run('pnpm', ['exec', 'svelte-kit', 'sync'], { cwd, env });
        const check = run('pnpm', ['run', 'check'], { cwd, env });
        const test = run('pnpm', ['run', 'test'], { cwd, env });
        // Without a terminal, svelte-check prints "<timestamp> COMPLETED <n> FILES <n> ERRORS ...".
        const checked = summary(check, /COMPLETED|svelte-check found/).replace(/^\d+\s+/, '');
        return `svelte-check: ${checked}\n  ✓ vitest: ${summary(test, /^Tests\s/)}`;
    }],

    ['Synthesize', () => {
        run('npx', ['cdk', 'synth', STACK_NAME, '--quiet']);
        return `${STACK_NAME} template is valid (cdk.out/)`;
    }],

    ['Stack state', () => {
        const status = stackStatus(config, STACK_NAME);
        if (status === null) {
            return `${STACK_NAME} does not exist yet: a deploy creates it`;
        }
        if (status === 'ROLLBACK_COMPLETE') {
            throw new StepError(`${STACK_NAME} is ROLLBACK_COMPLETE: a failed first create. Delete it before deploying.`);
        }
        if (status.endsWith('_IN_PROGRESS')) {
            throw new StepError(`${STACK_NAME} is ${status}: wait for it to finish.`);
        }
        return `${STACK_NAME} ${status}`;
    }],

    ['Changes', () => {
        run('npx', ['cdk', 'diff', STACK_NAME, '--no-change-set', '--no-notices'], { inherit: true });
        return 'Diff above';
    }],
];

function main(): number {
    const mode = deploy ? 'DEPLOY' : 'DRY RUN';
    console.log(`${mode}: ${STACK_NAME}\n`);

    for (const [index, [title, check]] of steps.entries()) {
        console.log(`[${index + 1}/${steps.length}] ${title}`);
        const started = Date.now();
        try {
            const result = check();
            const seconds = Math.round((Date.now() - started) / 1000);
            console.log(`  ✓ ${result}${seconds >= 5 ? ` (${seconds}s)` : ''}\n`);
        } catch (error) {
            const message = (error as Error).message.replace(/\n/g, '\n    ');
            console.log(`  ✗ ${message}\n`);
            console.log(`${mode} stopped at step ${index + 1}. Nothing was deployed.`);
            return 1;
        }
    }

    if (!deploy) {
        console.log('DRY RUN passed. Nothing was deployed.');
        console.log('To deploy: make deploy-stack DEPLOY=1');
        return 0;
    }

    console.log('All checks passed. Deploying.\n');
    try {
        run('npx', ['cdk', 'deploy', STACK_NAME, '--outputs-file', 'outputs.json', '--rollback'], { inherit: true });
    } catch (error) {
        console.log(`✗ ${(error as Error).message}`);
        return 1;
    }
    console.log(`\nDeployed ${STACK_NAME}. Outputs in outputs.json.`);
    return 0;
}

process.exit(main());
