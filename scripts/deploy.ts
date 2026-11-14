/**
 * Check everything a deploy needs, and deploy only when asked.
 *
 *   npx ts-node scripts/deploy.ts            dry run: read-only checks, nothing deployed
 *   npx ts-node scripts/deploy.ts --deploy   the same checks, then `cdk deploy`
 *
 * Every AWS call in the checks is read-only. `cdk diff` runs with
 * --no-change-set, because a change set is created with the deploy role.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import { Config, ENV_FILE, getConfigFromFile } from '../lib/config';
import { STACK_NAME } from '../lib/match-cdk-stack';

const MIN_NODE = [22, 12];
const SUBMODULE_CONFIG = 'vendor/match-config/config/default.yaml';
const BOOTSTRAP_STACK = 'CDKToolkit';

class StepError extends Error {}

/** Run a command. `inherit` streams its output, for long or interactive commands. */
function run(cmd: string, args: string[], inherit = false): string {
    const result = spawnSync(cmd, args, { encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe' });
    if (result.error) {
        throw new StepError(`Could not start \`${cmd}\`: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const output = (result.stderr || result.stdout || '').trim();
        throw new StepError(`\`${cmd} ${args.join(' ')}\` exited with ${result.status}${output ? `:\n${output}` : ''}`);
    }
    return result.stdout ?? '';
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

const deploy = process.argv.includes('--deploy');
let config: Config;

const steps: [string, () => string][] = [
    ['Prerequisites', () => {
        const [major, minor] = process.versions.node.split('.').map(Number);
        if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
            throw new StepError(`Node ${process.versions.node} is too old: match-config needs >= ${MIN_NODE.join('.')}.`);
        }
        if (!fs.existsSync(SUBMODULE_CONFIG)) {
            throw new StepError(`${SUBMODULE_CONFIG} is missing. Run \`git submodule update --init --recursive\`.`);
        }
        if (!fs.existsSync(ENV_FILE)) {
            throw new StepError(`${ENV_FILE} is missing. It needs AWS_ACCOUNT_ID, AWS_KEY_PAIR and DOCKER_DIR.`);
        }
        return `Node ${process.versions.node}, match-config present, env file ${ENV_FILE}`;
    }],

    ['Config', () => {
        config = getConfigFromFile(ENV_FILE);
        return `${config.name} (ENV=${config.env}): account ${config.aws_account}, ${config.aws_region}, ${config.instance_type}`;
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
        run('npx', ['cdk', 'diff', STACK_NAME, '--no-change-set', '--no-notices'], true);
        return 'Diff above';
    }],
];

function main(): number {
    const mode = deploy ? 'DEPLOY' : 'DRY RUN';
    console.log(`${mode}: ${STACK_NAME}\n`);

    for (const [index, [title, check]] of steps.entries()) {
        console.log(`[${index + 1}/${steps.length}] ${title}`);
        try {
            console.log(`  ✓ ${check()}\n`);
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
        run('npx', ['cdk', 'deploy', STACK_NAME, '--outputs-file', 'outputs.json', '--rollback'], true);
    } catch (error) {
        console.log(`✗ ${(error as Error).message}`);
        return 1;
    }
    console.log(`\nDeployed ${STACK_NAME}. Outputs in outputs.json.`);
    return 0;
}

process.exit(main());
