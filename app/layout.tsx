import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BKM Operations Hub',
  description: 'BKM Associates internal operations demonstration environment',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
