import './globals.css';

export const metadata = {
  title: 'legalprotech',
  description: 'legalprotech workspace for chatbot, image and video generation.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
