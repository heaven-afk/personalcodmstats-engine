import Providers from './Providers';
import './globals.css';

export const metadata = {
  title: 'Heaven Stat Engine',
  description: 'Personal tournament stat platform for CODM Battle Royale',
  icons: {
    icon: '/brand/06_app_favicon.png',
    apple: '/brand/06_app_favicon.png',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
