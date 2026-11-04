import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Finsk',
  description: 'Chat with your documents as knowledge graphs'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
