import { Construct } from 'constructs';

import * as t from './config';

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';



export class MatchCdkStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const config = t.getConfigFromFile('.env')
    console.log(`Starting for configuration: ${config.name}`)

    function _prefixed(s: string) {
      return config.name + '_' + s
    }

    const defaultVPC = ec2.Vpc.fromLookup(this, _prefixed('VPC'), { isDefault: true })


    const user = new iam.User(this, _prefixed('user'));
    const accessKey = new iam.AccessKey(this, _prefixed('access_key'), { user });

    // create a role for the instance
    const ec2Role = new iam.Role(
      this,
      _prefixed('Role'),
      { assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com') }
    )
    
    const securityGroupName = _prefixed('sg')
    const securityGroup = new ec2.SecurityGroup(
      this,
      securityGroupName,
      {
        vpc: defaultVPC,
        allowAllOutbound: true,
        securityGroupName: securityGroupName
      }
    )
    
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(config.httpPort),
      'Allow HTTP access'
    )

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(config.httpsPort),
      'Allow HTTPS access'
    )

    const keyPair = ec2.KeyPair.fromKeyPairAttributes(this, 'KeyPair', {
      keyPairName: config.awsKeyPair,
      type: ec2.KeyPairType.RSA,
    })

    const Ec2InstanceName = _prefixed('ec2_instance')
    const instance = new ec2.Instance(this, Ec2InstanceName, {
      vpc: defaultVPC,
      role: ec2Role,
      securityGroup: securityGroup,
      instanceName: Ec2InstanceName,
      instanceType: new ec2.InstanceType(config.instanceType),
      machineImage: ec2.MachineImage.latestAmazonLinux2(
        {cpuType: ec2.AmazonLinuxCpuType.ARM_64}
    ),
      keyName: keyPair.keyPairName
    }
    )
  }
}
