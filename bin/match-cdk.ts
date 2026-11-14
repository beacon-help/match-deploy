#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MatchCdkStack, STACK_NAME } from '../lib/match-cdk-stack';
import { ENV_FILE, getConfigFromFile } from '../lib/config';


const config = getConfigFromFile(ENV_FILE)

const app = new cdk.App();
new MatchCdkStack(app, STACK_NAME, {
  config,
  env: { account: config.aws_account, region: config.aws_region },
});
