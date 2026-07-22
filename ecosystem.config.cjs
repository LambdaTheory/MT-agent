const { join } = require('node:path');

const rootDir = __dirname;
const rentalPriceAgentDir = process.env.RENTAL_PRICE_AGENT_DIR || join(rootDir, 'vendor', 'rental-price-agent');

module.exports = {
  apps: [
    {
      name: 'mt-feishu-bot',
      cwd: rootDir,
      script: 'src/cli/feishuBotSdk.ts',
      interpreter: process.execPath,
      interpreter_args: '--import tsx',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 3000,
      out_file: 'output/feishu-bot-sdk.out.log',
      error_file: 'output/feishu-bot-sdk.err.log',
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'production',
        RENTAL_PRICE_AGENT_DIR: rentalPriceAgentDir,
      },
    },
    {
      name: 'mt-rental-price-agent',
      cwd: rentalPriceAgentDir,
      script: 'scripts/playwright-runner.js',
      args: 'daemon start --port=9223',
      interpreter: process.execPath,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      out_file: join(rootDir, 'output', 'rental-price-agent.out.log'),
      error_file: join(rootDir, 'output', 'rental-price-agent.err.log'),
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'production',
        RENTAL_PRICE_AGENT_DIR: rentalPriceAgentDir,
      },
    },
  ],
};
