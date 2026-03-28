/**
 * AWS Provider for Edge Auto-Scaling
 *
 * Manages EC2 Auto Scaling Group to scale edge servers dynamically.
 * New EC2 instances boot, run user-data script to start edge server,
 * which self-registers with Origin via the internal API.
 *
 * Requirements:
 *   npm install @aws-sdk/client-auto-scaling @aws-sdk/client-ec2
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('aws-provider');

// Lazy-load AWS SDK (only when actually used)
let AutoScalingClient, SetDesiredCapacityCommand, DescribeAutoScalingGroupsCommand;
let EC2Client, DescribeInstancesCommand, TerminateInstancesCommand;

async function loadAwsSdk() {
  if (!AutoScalingClient) {
    try {
      const asgModule = await import('@aws-sdk/client-auto-scaling');
      AutoScalingClient = asgModule.AutoScalingClient;
      SetDesiredCapacityCommand = asgModule.SetDesiredCapacityCommand;
      DescribeAutoScalingGroupsCommand = asgModule.DescribeAutoScalingGroupsCommand;

      const ec2Module = await import('@aws-sdk/client-ec2');
      EC2Client = ec2Module.EC2Client;
      DescribeInstancesCommand = ec2Module.DescribeInstancesCommand;
      TerminateInstancesCommand = ec2Module.TerminateInstancesCommand;

      log.info('AWS SDK loaded successfully');
    } catch (err) {
      log.error('Failed to load AWS SDK. Install with: npm install @aws-sdk/client-auto-scaling @aws-sdk/client-ec2');
      throw new Error('AWS SDK not available');
    }
  }
}

export class AwsProvider {
  /**
   * @param {object} cfg
   * @param {string} cfg.asgName        – Auto Scaling Group name
   * @param {string} cfg.region         – AWS region (e.g. "us-east-1")
   * @param {number} cfg.maxCapacity    – Hard ceiling for ASG
   * @param {object} cfg.redisClient    – Redis client for edge tracking
   */
  constructor(cfg = {}) {
    this.cfg = {
      asgName:     cfg.asgName     || process.env.AWS_ASG_NAME     || 'broadclass-edge-asg',
      region:      cfg.region      || process.env.AWS_REGION       || 'us-east-1',
      maxCapacity: parseInt(cfg.maxCapacity) || 20,
    };

    this.redisClient = cfg.redisClient || null;
    this._asgClient = null;
    this._ec2Client = null;
    this._initialized = false;

    log.info(`AWS provider configured — ASG=${this.cfg.asgName} region=${this.cfg.region}`);
  }

  async _ensureInitialized() {
    if (this._initialized) return;

    await loadAwsSdk();

    this._asgClient = new AutoScalingClient({ region: this.cfg.region });
    this._ec2Client = new EC2Client({ region: this.cfg.region });
    this._initialized = true;
  }

  /*  Provider Interface                                              */

  /**
   * Scale up: Increase ASG desired capacity by 1.
   * AWS will launch a new EC2 instance which will self-register.
   * 
   * @param {string} serverId  – Suggested server ID (AWS assigns its own)
   * @param {number} edgeNum   – Edge number for logging
   */
  async launchEdge(serverId, edgeNum) {
    await this._ensureInitialized();

    try {
      // Get current ASG state
      const describeCmd = new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: [this.cfg.asgName],
      });
      const asgInfo = await this._asgClient.send(describeCmd);
      const asg = asgInfo.AutoScalingGroups?.[0];

      if (!asg) {
        throw new Error(`ASG "${this.cfg.asgName}" not found`);
      }

      const currentDesired = asg.DesiredCapacity;
      const maxSize = asg.MaxSize;
      const newDesired = currentDesired + 1;

      if (newDesired > maxSize) {
        log.warn(`Cannot scale up: would exceed ASG max size (${maxSize})`);
        return null;
      }

      // Increase desired capacity
      const setCapacityCmd = new SetDesiredCapacityCommand({
        AutoScalingGroupName: this.cfg.asgName,
        DesiredCapacity: newDesired,
        HonorCooldown: false,
      });
      await this._asgClient.send(setCapacityCmd);

      log.info(`ASG "${this.cfg.asgName}" scaled up: ${currentDesired} → ${newDesired}`);
      return serverId;
    } catch (err) {
      log.error(`Failed to scale up ASG: ${err.message}`);
      throw err;
    }
  }

  /**
   * Scale down: Decrease ASG desired capacity by 1.
   * Optionally terminate a specific instance if we can identify it.
   * 
   * @param {string} serverId – Server ID to remove
   */
  async removeEdge(serverId) {
    await this._ensureInitialized();

    try {
      // Get current ASG state
      const describeCmd = new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: [this.cfg.asgName],
      });
      const asgInfo = await this._asgClient.send(describeCmd);
      const asg = asgInfo.AutoScalingGroups?.[0];

      if (!asg) {
        throw new Error(`ASG "${this.cfg.asgName}" not found`);
      }

      const currentDesired = asg.DesiredCapacity;
      const minSize = asg.MinSize;
      const newDesired = currentDesired - 1;

      if (newDesired < minSize) {
        log.warn(`Cannot scale down: would go below ASG min size (${minSize})`);
        return;
      }

      // Decrease desired capacity (ASG will terminate oldest instance)
      const setCapacityCmd = new SetDesiredCapacityCommand({
        AutoScalingGroupName: this.cfg.asgName,
        DesiredCapacity: newDesired,
        HonorCooldown: false,
      });
      await this._asgClient.send(setCapacityCmd);

      log.info(`ASG "${this.cfg.asgName}" scaled down: ${currentDesired} → ${newDesired}`);
    } catch (err) {
      log.error(`Failed to scale down ASG: ${err.message}`);
      throw err;
    }
  }

  /**
   * Check if an edge server is running (via Redis registration).
   * In AWS mode, we rely on edges self-registering via HTTP heartbeats.
   * 
   * @param {string} serverId
   * @returns {Promise<boolean>}
   */
  async isEdgeRunning(serverId) {
    // In AWS mode, edges self-register. Check Redis for heartbeat.
    if (this.redisClient) {
      try {
        const edges = await this.redisClient.getAllEdges();
        return edges.some(e => e.serverId === serverId && e.isAlive);
      } catch (err) {
        log.warn(`Failed to check edge status: ${err.message}`);
      }
    }
    return true; // Assume running if we can't check
  }

  /**
   * Get current ASG status for monitoring.
   */
  async getAsgStatus() {
    await this._ensureInitialized();

    try {
      const describeCmd = new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: [this.cfg.asgName],
      });
      const asgInfo = await this._asgClient.send(describeCmd);
      const asg = asgInfo.AutoScalingGroups?.[0];

      if (!asg) return null;

      return {
        name: asg.AutoScalingGroupName,
        desired: asg.DesiredCapacity,
        min: asg.MinSize,
        max: asg.MaxSize,
        instances: asg.Instances?.length || 0,
        healthyInstances: asg.Instances?.filter(i => i.HealthStatus === 'Healthy').length || 0,
      };
    } catch (err) {
      log.error(`Failed to get ASG status: ${err.message}`);
      return null;
    }
  }
}
