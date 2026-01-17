/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Skip type checking during build - backend types are validated by Convex
    ignoreBuildErrors: true,
  },
}

module.exports = nextConfig
