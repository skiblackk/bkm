const DEFAULT_API_BASE = 'https://api.respond.io/v2';
const DEFAULT_GMAIL_CHANNEL_ID = 563627;

function getConfig() {
  return {
    token: process.env.RESPOND_IO_API_TOKEN,
    baseUrl: (process.env.RESPOND_IO_API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, ''),
    gmailChannelId: Number(process.env.RESPOND_IO_GMAIL_CHANNEL_ID || DEFAULT_GMAIL_CHANNEL_ID),
    workspaceId: process.env.RESPOND_IO_WORKSPACE_ID || '479271',
  };
}

export function getRespondIoStatus() {
  const config = getConfig();
  return {
    provider: 'Respond.io',
    workspaceId: config.workspaceId,
    gmailChannelId: config.gmailChannelId,
    channelName: 'SMTP - Gmail',
    providerChannelConnected: true,
    bridgeConfigured: Boolean(config.token),
    bridgeMessage: config.token
      ? 'Server bridge configured. Gmail messages can be read and approved replies can be sent.'
      : 'Add RESPOND_IO_API_TOKEN to enable live server-side message sync and sending.',
  };
}
