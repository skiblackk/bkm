import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BKM Associates | Operations Control Room',
  description: 'A focused internal control room for BKM Audit, Tax and Advisory delivery.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
