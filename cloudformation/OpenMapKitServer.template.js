const cf = require('@mapbox/cloudfriend');

const Parameters = {
  ELBSecurityGroup: {
    Description: 'Security Group for the ELB',
    Type: 'String'
  },
  ELBSubnets: {
    Description: 'ELB subnets',
    Type: 'String'
  },
  EC2SecurityGroup: {
    Description: 'EC2 security group',
    Type: 'String'
  },
  S3Bucket: {
    Description: 'S3 bucket',
    Type: 'String'
  },
  S3Prefix: {
    Description: 'S3 prefix for the bucket',
    Type: 'String'
  },
  OpenMapKitVersion: {
    Description: 'OpenMapKit Version, to download and extract the frontend',
    Type: 'String'
  },
  EnableS3Sync: {
    AllowedValues: [
       'true',
       'false'
    ],
    Default: 'true',
    Description: 'Enable S3 sync',
    Type: 'String'
  },
  NodeEnvironment: {
    AllowedValues: [
       'production',
       'staging'
    ],
    Default: 'staging',
    Description: 'NODE_ENV environment variable',
    Type: 'String'
  },
  SSLCertificateIdentifier: {
    Type: 'String',
    Description: 'SSL certificate for HTTPS protocol'
  },
  UsersS3Bucket: {
   Description: 'Bucket with login details. Logins are stored at S3://<UsersS3Bucket>/<OMK_stack_name>/users.json',
   Type: 'String'
  }
};

const Resources = {
  OpenMapKitServerASG: {
    DependsOn: 'OpenMapKitServerLaunchConfiguration',
    Type: 'AWS::AutoScaling::AutoScalingGroup',
    Properties: {
      AutoScalingGroupName: cf.stackName,
      Cooldown: 300,
      MinSize: 0,
      DesiredCapacity: 1,
      MaxSize: 1,
      HealthCheckGracePeriod: 300,
      LaunchConfigurationName: cf.stackName,
      LoadBalancerNames: [ cf.ref('OpenMapKitServerLoadBalancer') ],
      HealthCheckType: 'EC2',
      AvailabilityZones: cf.getAzs(cf.region)
    }
  },
  OpenMapKitServerScaleUp: {
      Type: 'AWS::AutoScaling::ScalingPolicy',
      Properties: {
        AutoScalingGroupName: cf.ref('OpenMapKitServerASG'),
        PolicyType: 'TargetTrackingScaling',
        TargetTrackingConfiguration: {
          TargetValue: 85,
          PredefinedMetricSpecification: {
            PredefinedMetricType: 'ASGAverageCPUUtilization'
          }
        },
        Cooldown: 300
      }
  },
  OpenMapKitServerLaunchConfiguration: {
    Type: 'AWS::AutoScaling::LaunchConfiguration',
      Properties: {
        IamInstanceProfile: cf.ref('OpenMapKitServerEC2InstanceProfile'),
        ImageId: 'ami-08b8af1c94b41235d',
        InstanceType: 't2.medium',
        LaunchConfigurationName: cf.stackName,
        SecurityGroups: [cf.ref('EC2SecurityGroup')],
        UserData: cf.userData([
          '#!/bin/bash',
          'apt update -y &&',
          'apt upgrade -y &&',
          'apt install -y --no-install-recommends apt-transport-https curl software-properties-common &&',
          'curl -sf https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add - &&',
          'add-apt-repository -y -s "deb https://deb.nodesource.com/node_6.x $(lsb_release -c -s) main" &&',
          'apt install -y --no-install-recommends build-essential default-jre-headless git nodejs python python-dev python-pip python-setuptools python-wheel',
          'apt-get clean',
          'rm -rf /var/lib/apt/lists/*',
          'npm install -g yarn',
          'rm -rf /root/.npm',
          'mkdir -p /app',
          cf.sub('export AWSBUCKETNAME=${S3Bucket}'),
          cf.sub('export AWSBUCKETPREFIX=${S3Prefix}'),
          cf.sub('export ENABLES3SYNC=${EnableS3Sync}'),
          cf.sub('export NODE_ENV=${NodeEnvironment}'),
          'cd /app && git clone https://github.com/hotosm/OpenMapKitServer.git .',
          'pip install -r requirements.txt',
          cf.sub('aws s3 cp s3://${UsersS3Bucket}/${AWS::StackName}/users.json /app/util/users.json'),
          'yarn && rm -rf /root/.cache/yarn',
          cf.sub('wget https://github.com/hotosm/OpenMapKitServer/archive/${OpenMapKitVersion}-frontend.tar.gz -P /tmp/'),
          'rm frontend/build/* -R',
          cf.sub('tar -xvzf /tmp/${OpenMapKitVersion}-frontend.tar.gz -C frontend/build/ --strip 1'),
          'git submodule update --init',
          'yarn get_from_s3',
          'node server.js &'
        ]),
        KeyName: 'mbtiles'
      }
  },
  OpenMapKitServerEC2Role: {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: {
             Service: [ 'ec2.amazonaws.com' ]
          },
          Action: [ 'sts:AssumeRole' ]
        }]
      },
      Policies: [{
        PolicyName: 'S3Policy',
        PolicyDocument: {
          Version: '2012-10-17',
          Statement:[{
            Action: [ 's3:ListBucket'],
            Effect: 'Allow',
            Resource: [
              cf.sub('arn:aws:s3:::${S3Bucket}'),
              cf.sub('arn:aws:s3:::${UsersS3Bucket}')
            ]
          }, {
            Action: [
                's3:GetObject',
                's3:GetObjectAcl',
                's3:PutObject',
                's3:PutObjectAcl',
                's3:ListObjects',
                's3:DeleteObject'
            ],
            Effect: 'Allow',
            Resource: [
                cf.sub('arn:aws:s3:::${S3Bucket}*')
            ]
          }, {
           Action: [
               's3:GetObject',
               's3:GetObjectAcl',
               's3:ListObjects'
           ],
           Effect: 'Allow',
           Resource: [
               cf.join('/', [cf.sub('arn:aws:s3:::${UsersS3Bucket}'), cf.stackName, 'users.json'])
           ]
         }]
        }
      }],
      RoleName: cf.join('-', [cf.stackName, 'ec2', 'role'])
    }
  },
  OpenMapKitServerEC2InstanceProfile: {
     Type: 'AWS::IAM::InstanceProfile',
     Properties: {
        Roles: [cf.ref('OpenMapKitServerEC2Role')],
        InstanceProfileName: cf.join('-', [cf.stackName, 'ec2', 'instance', 'profile'])
     }
  },
  OpenMapKitServerLoadBalancer: {
    Type: 'AWS::ElasticLoadBalancing::LoadBalancer',
    Properties: {
      CrossZone: true,
      HealthCheck: {
        HealthyThreshold: 5,
        Interval: 10,
        Target: 'HTTP:3210/',
        Timeout: 9,
        UnhealthyThreshold: 3
      },
      Listeners: [{
        InstancePort: 3210,
        InstanceProtocol: 'HTTP',
        LoadBalancerPort: 80,
        Protocol: 'HTTP'
      },
      {
        InstancePort: 3210,
        InstanceProtocol: 'HTTP',
        LoadBalancerPort: 443,
        Protocol: 'HTTPS',
        SSLCertificateId: cf.arn('acm', cf.ref('SSLCertificateIdentifier'))
      }],
      LoadBalancerName: cf.stackName,
      Scheme: 'internet-facing',
      SecurityGroups: [cf.ref('ELBSecurityGroup')],
      Subnets: cf.split(',', cf.ref('ELBSubnets'))
   }
 }
};

module.exports = { Parameters, Resources }
