import { getRespondIoStatus } from '@/lib/respond-io';

/**
 * Demo integration state.
 *
 * Respond.io is enabled and its active workspace exposes an SMTP Gmail channel.
 * The same workspace currently exposes no WhatsApp or SMS channels. Production should replace this fixture with an
 * OAuth-backed server-side integration record.
 */
export function getIntegrationStatus() {
  const bridge = getRespondIoStatus();
  return {
    gmail: {
      connected: true,
      label: 'Connected via Respond.io · SMTP - Gmail',
      detail: `Respond.io channel 563627 is connected as SMTP - Gmail. ${bridge.bridgeMessage}`,
      bridgeConfigured: bridge.bridgeConfigured,
    },
    respondIo: {
      connected: true,
      label: 'Respond.io enabled · Gmail channel connected',
      detail: 'The current workspace has Gmail connected, but no WhatsApp Business or SMS channel.',
      whatsappChannels: 0,
      smsChannels: 0,
    },
    direct: {
      whatsapp: { connected: false, label: 'Direct Meta connection not configured' },
      sms: { connected: false, label: 'Direct SMS provider not configured' },
    },
  };
}
