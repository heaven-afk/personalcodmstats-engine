'use client';
import { AuthProvider } from '@/contexts/AuthContext';
import { SWRConfig } from 'swr';
import { Toaster } from 'react-hot-toast';

export default function Providers({ children }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        dedupingInterval: 5000,
        keepPreviousData: true,
      }}
    >
      <AuthProvider>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#1E293B',
              color: '#F1F5F9',
              border: '1px solid rgba(255,255,255,0.08)',
              fontFamily: 'Inter, sans-serif',
            },
            success: { iconTheme: { primary: '#C9A84C', secondary: '#000' } },
            error: { iconTheme: { primary: '#FC3E3E', secondary: '#fff' } },
          }}
        />
      </AuthProvider>
    </SWRConfig>
  );
}
