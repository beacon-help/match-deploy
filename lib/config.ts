import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { z } from 'zod';


const ConfigSchema = z.object({
    awsAccount: z.string(),
    awsRegion: z.string(),
    awsKeyPair: z.string(),
    name: z.string(),
    dockerImageDir: z.string(),
    githubBranch: z.string()
})

type Config = z.infer<typeof ConfigSchema>;


export function getConfigFromFile(fileDir: string): Config {
    if (!fs.existsSync(fileDir)) {
        throw Error(`Config file not found in the directory ${fileDir}.`)
    }

    dotenv.config({path: fileDir});

    const config = ConfigSchema.parse(
        {
            awsAccount: process.env.AWS_ACCOUNT_ID,
            awsRegion: process.env.AWS_REGION,
            awsKeyPair: process.env.AWS_KEY_PAIR,
            name: process.env.NAME,
            dockerImageDir: process.env.DOCKER_DIR,
            githubBranch: process.env.GITHUB_BRANCH
        }
    )
   
    return config
}
