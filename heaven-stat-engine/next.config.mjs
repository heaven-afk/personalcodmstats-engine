/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    'firebase-admin',
    'firebase-admin/app',
    'firebase-admin/auth',
    'firebase-admin/firestore',
    'firebase-admin/database',
    'firebase-admin/storage',
    'nodemailer',
    'jwks-rsa',
    'jose',
    'node-fetch',
  ],
  allowedDevOrigins: ['10.31.178.27'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: 'i.imgur.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
    ],
  },
};

export default nextConfig;
