export function GmailBrandIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return <img src="/brand-icons-gmail.svg" alt="Gmail" className={className} aria-hidden="true" />;
}

export function WhatsAppBrandIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return <img src="/brand-icons-whatsapp.svg" alt="WhatsApp" className={className} aria-hidden="true" />;
}

export function SmsBrandIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" role="img" aria-label="SMS" fill="none">
      <path d="M5.5 7.5h21a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H16l-6.2 4v-4H5.5a3 3 0 0 1-3-3v-10a3 3 0 0 1 3-3Z" fill="#2563EB" />
      <text x="16" y="18.8" textAnchor="middle" fontSize="7.5" fontWeight="800" fontFamily="Arial, sans-serif" fill="white">SMS</text>
    </svg>
  );
}
