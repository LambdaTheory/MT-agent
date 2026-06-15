module.exports = {
  apps: [
    {
      name: 'mt-feishu-bot',
      cwd: __dirname,
      script: 'src/cli/feishuBotSdk.ts',
      interpreter: process.execPath,
      interpreter_args: '--import tsx',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      out_file: 'output/feishu-bot-sdk.out.log',
      error_file: 'output/feishu-bot-sdk.err.log',
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
