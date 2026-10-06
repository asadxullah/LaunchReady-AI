/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  serverExternalPackages: ['pdf-parse', '@napi-rs/canvas', 'exceljs'],
  outputFileTracingIncludes: {
    '/api/intake': ['./node_modules/pdf-parse/dist/**/*', './node_modules/@napi-rs/canvas/**/*'],
  },
}
export default nextConfig
