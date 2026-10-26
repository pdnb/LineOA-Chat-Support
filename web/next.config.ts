import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Loaded with Node's require at runtime instead of being bundled into route handlers.
  serverExternalPackages: ['@prisma/client', '@line/bot-sdk', 'socket.io', 'bcryptjs'],
  // Dev only: let the console be opened through an ngrok / Cloudflare quick tunnel (HMR socket, dev fonts).
  allowedDevOrigins: ['*.trycloudflare.com', '*.ngrok-free.app', '*.ngrok-free.dev', '*.ngrok.app'],
};

export default nextConfig;
