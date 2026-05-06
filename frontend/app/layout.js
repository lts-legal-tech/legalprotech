import './globals.css';
import Script from 'next/script';

export const metadata = {
  title: 'legalprotech',
  description: 'legalprotech workspace for chatbot, image and video generation.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Script id="strip-extension-hydration-attrs" strategy="beforeInteractive">
          {`(() => {
            const strip = (root = document) => {
              root.querySelectorAll?.('[bis_skin_checked]').forEach((el) => el.removeAttribute('bis_skin_checked'));
            };
            strip();
            new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'bis_skin_checked') {
                  mutation.target.removeAttribute('bis_skin_checked');
                }
                for (const node of mutation.addedNodes || []) {
                  if (node?.nodeType === 1) {
                    node.removeAttribute?.('bis_skin_checked');
                    strip(node);
                  }
                }
              }
            }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['bis_skin_checked'] });
          })();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
