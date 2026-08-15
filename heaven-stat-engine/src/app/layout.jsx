import Providers from './Providers';
import './globals.css';

export const metadata = {
  title: 'Heaven Stat Engine',
  description: 'Personal tournament stat platform for CODM Battle Royale',
  icons: {
    icon: [
      { url: '/favicon.ico?v=3' },
      { url: '/brand/heaven_stat_engine_app_icon.png?v=3', sizes: '128x128', type: 'image/png' },
    ],
    apple: [
      { url: '/brand/heaven_stat_engine_app_icon.png?v=3', sizes: '128x128', type: 'image/png' },
    ],
    shortcut: ['/favicon.ico?v=3'],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico?v=3" sizes="any" />
        <link rel="icon" href="/brand/heaven_stat_engine_app_icon.png?v=3" type="image/png" />
        <link rel="apple-touch-icon" href="/brand/heaven_stat_engine_app_icon.png?v=3" />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
