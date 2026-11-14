import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { getConfig, type DeployConfig } from 'match-config';
import { z } from 'zod';


/** The private env file. DEPLOY_ENV_FILE points elsewhere, e.g. for a dry run against a test file. */
export const ENV_FILE = process.env.DEPLOY_ENV_FILE ?? '.env'

// Private values: they stay in .env because match-config is public.
const SecretsSchema = z.object({
    aws_account: z.string(),
    aws_key_pair: z.string(),
    docker_image_dir: z.string()
})

/** Shared values (match-config `deploy` section) plus the private ones from .env. */
export type Config = DeployConfig & z.infer<typeof SecretsSchema>


export function getConfigFromFile(fileDir: string): Config {
    if (!fs.existsSync(fileDir)) {
        throw Error(`Config file not found in the directory ${fileDir}.`)
    }

    dotenv.config({path: fileDir});

    const secrets = SecretsSchema.parse(
        {
            aws_account: process.env.AWS_ACCOUNT_ID,
            aws_key_pair: process.env.AWS_KEY_PAIR,
            docker_image_dir: process.env.DOCKER_DIR
        }
    )

    // Read after dotenv, so ENV can be set in the .env file too.
    return { ...getConfig('deploy'), ...secrets }
}
