/**
 * Demo integration state.
 *
 * The Manus Gmail connector is enabled and has passed a read-only inbox test in
 * this task. Respond.io is enabled, but its workspace currently exposes no
 * WhatsApp or SMS channels. Production should replace this fixture with an
 * OAuth-backed server-side integration record.
 */
export function getIntegrationStatus() {
  return {
    gmail: {
      connected: true,
      label: 'Connected · read test passed',
      detail: 'Current authorized Gmail connector; company mailbox identity should be confirmed before sending.',
    },
    respondIo: {
      connected: true,
      label: 'Respond.io enabled · no channels',
      detail: 'No WhatsApp Business or SMS channel is connected in the current workspace.',
      whatsappChannels: 0,
      smsChannels: 0,
    },
    direct: {
      whatsapp: { connected: false, label: 'Direct Meta connection not configured' },
      sms: { connected: false, label: 'Direct SMS provider not configured' },
    },
  };
}
