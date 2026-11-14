import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { getConfig } from 'match-config';
import { z } from 'zod';


// Private values: they stay in .env because match-config is public.
const SecretsSchema = z.object({
    awsAccount: z.string(),
    awsKeyPair: z.string(),
    dockerImageDir: z.string()
})

/** Shared values (match-config `deploy` section) plus the private ones from .env. */
export type Config = z.infer<typeof SecretsSchema> & {
    name: string,
    awsRegion: string,
    githubBranch: string,
    backendRepo: string,
    instanceType: string,
    httpPort: number,
    httpsPort: number
}


export function getConfigFromFile(fileDir: string): Config {
    if (!fs.existsSync(fileDir)) {
        throw Error(`Config file not found in the directory ${fileDir}.`)
    }

    dotenv.config({path: fileDir});

    const secrets = SecretsSchema.parse(
        {
            awsAccount: process.env.AWS_ACCOUNT_ID,
            awsKeyPair: process.env.AWS_KEY_PAIR,
            dockerImageDir: process.env.DOCKER_DIR
        }
    )

    // Read after dotenv, so ENV can be set in the .env file too.
    const shared = getConfig('deploy')

    return {
        ...secrets,
        name: shared.name,
        awsRegion: shared.aws_region,
        githubBranch: shared.github_branch,
        backendRepo: shared.backend_repo,
        instanceType: shared.instance_type,
        httpPort: shared.http_port,
        httpsPort: shared.https_port
    }
}
