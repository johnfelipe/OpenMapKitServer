const cf = require('@mapbox/cloudfriend');

const Parameters = {
  GitSha: {
    Type: 'String',
    Description: 'GitSha for this stack'
  },
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
      Type: "AWS::AutoScaling::ScalingPolicy",
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
        ImageId: 'ami-0e4372c1860d7426c',
        InstanceType: 't2.medium',
        LaunchConfigurationName: cf.stackName,
        SecurityGroups: [cf.ref('EC2SecurityGroup')],
        UserData: cf.userData([
          '#!/bin/bash',
          'apt update -y \ ',
          ' && apt upgrade -y \ ',
          ' && apt install -y --no-install-recommends \ ',
          '   apt-transport-https \ ',
          '   curl \ ',
          '   software-properties-common \ ',
          ' && curl -sf https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add - \ ',
          ' && add-apt-repository -y -u -s "deb https://deb.nodesource.com/node_6.x $(lsb_release -c -s) main" \ ',
          ' && apt install -y --no-install-recommends \ ',
          '   build-essential \ ',
          '   default-jre-headless \ ',
          '   git \ ',
          '   nodejs \ ',
          '   python \ ',
          '   python-dev \ ',
          '   python-pip \ ',
          '   python-setuptools \ ',
          '   python-wheel \ ',
          ' && apt-get clean \ ',
          '&& rm -rf /var/lib/apt/lists/* ',
          'npm install -g yarn \ ',
          '&& rm -rf /root/.npm',
          'mkdir -p /app',
          'git clone https://github.com/hotosm/OpenMapKitServer.git && cp -R OpenMapKitServer/* /app/ && cd app',
          'pip install -r requirements.txt',
          'yarn && rm -rf /root/.cache/yarn',
          'yarn pushbuild',
          'git submodule update --init \ ',
          '&& useradd omkserver -m \ ',
          '&& chown -R omkserver:omkserver /app/data ',
          'su - omkserver',
          'export NODE_ENV=production',
          'node server.js &',
          'yarn get_from_s3'
        ]),
        KeyName: 'mbtiles'
      }
  },
  OpenMapKitServerEC2Role: {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Principal: {
             Service: [ "ec2.amazonaws.com" ]
          },
          Action: [ "sts:AssumeRole" ]
        }]
      },
      Policies: [{
        PolicyName: "S3Policy",
        PolicyDocument: {
          Version: "2012-10-17",
          Statement:[{
            Action: [ 's3:ListBucket'],
            Effect: 'Allow',
            Resource: [
              cf.sub('arn:aws:s3:::${S3Bucket}')
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
          }]
        }
      }],
      RoleName: cf.join('-', [cf.stackName, 'ec2', 'role'])
    }
  },
  OpenMapKitServerEC2InstanceProfile: {
     Type: "AWS::IAM::InstanceProfile",
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
      }],
      LoadBalancerName: cf.stackName,
      Scheme: 'internet-facing',
      SecurityGroups: [cf.ref('ELBSecurityGroup')],
      Subnets: cf.split(',', cf.ref('ELBSubnets'))
   }
 }
};

module.exports = { Parameters, Resources, Conditions }
