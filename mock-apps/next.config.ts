import type { NextConfig } from "next";

// ponytail: no cacheComponents. Every page reads live in-memory state, so nothing may be prerendered.
const nextConfig: NextConfig = {};

export default nextConfig;
