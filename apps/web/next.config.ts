import type { NextConfig } from 'next';
const config: NextConfig = { transpilePackages:['@llm-usage/core','@llm-usage/db','@llm-usage/providers'] };
export default config;
