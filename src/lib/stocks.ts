/**
 * xStocks (Backed Finance) — tokenized US equities & ETFs on Solana.
 *
 * Each xStock is an SPL Token-2022 mint, 1:1 backed by real shares held in
 * custody, tradeable on Jupiter/Raydium just like any other SPL token.
 * Trading reuses the existing /api/bags quote+swap rails (Jupiter-routed).
 *
 * Mint addresses verified via the official Solana xStocks case study:
 * https://solana.com/news/case-study-xstocks
 */

/** xStocks use 8 decimals (vs. 9 for SOL / Bags tokens) */
export const STOCK_DECIMALS = 8;

export interface StockToken {
  symbol: string;
  name: string;
  mint: string;
}

export const XSTOCKS: StockToken[] = [
  { symbol: "SPCXx", name: "SpaceX", mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8" },
  { symbol: "AAPLx", name: "Apple Inc.", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
  { symbol: "MSFTx", name: "Microsoft Corp.", mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX" },
  { symbol: "GOOGLx", name: "Alphabet Inc.", mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN" },
  { symbol: "AMZNx", name: "Amazon.com Inc.", mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg" },
  { symbol: "METAx", name: "Meta Platforms Inc.", mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu" },
  { symbol: "TSLAx", name: "Tesla Inc.", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB" },
  { symbol: "NVDAx", name: "NVIDIA Corp.", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
  { symbol: "AVGOx", name: "Broadcom Inc.", mint: "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo" },
  { symbol: "NFLXx", name: "Netflix Inc.", mint: "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL" },
  { symbol: "CRMx", name: "Salesforce Inc.", mint: "XsczbcQ3zfcgAEt9qHQES8pxKAVG5rujPSHQEXi4kaN" },
  { symbol: "ORCLx", name: "Oracle Corp.", mint: "XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL" },
  { symbol: "JPMx", name: "JPMorgan Chase & Co.", mint: "XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C" },
  { symbol: "Vx", name: "Visa Inc.", mint: "XsqgsbXwWogGJsNcVZ3TyVouy2MbTkfCFhCGGGcQZ2p" },
  { symbol: "MAx", name: "Mastercard Inc.", mint: "XsApJFV9MAktqnAc6jqzsHVujxkGm9xcSUffaBoYLKC" },
  { symbol: "WMTx", name: "Walmart Inc.", mint: "Xs151QeqTCiuKtinzfRATnUESM2xTU6V9Wy8Vy538ci" },
  { symbol: "MCDx", name: "McDonald's Corp.", mint: "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2" },
  { symbol: "COINx", name: "Coinbase Global Inc.", mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu" },
  { symbol: "CRCLx", name: "Circle Internet Group", mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1" },
  { symbol: "HOODx", name: "Robinhood Markets Inc.", mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg" },
  { symbol: "PLTRx", name: "Palantir Technologies Inc.", mint: "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4" },
  { symbol: "MSTRx", name: "Strategy (MicroStrategy) Inc.", mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ" },
  { symbol: "GMEx", name: "GameStop Corp.", mint: "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc" },
  { symbol: "BRK.Bx", name: "Berkshire Hathaway", mint: "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x" },
  { symbol: "SPYx", name: "SPDR S&P 500 ETF Trust", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" },
  { symbol: "QQQx", name: "Invesco QQQ Trust", mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ" },
  { symbol: "GLDx", name: "SPDR Gold Shares", mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re" },
];

export function getStockByMint(mint: string): StockToken | undefined {
  return XSTOCKS.find((s) => s.mint === mint);
}

/**
 * Official xStocks logo for a given symbol (served from Backed Finance's CDN).
 * Falls back gracefully in the UI if the image fails to load.
 */
export function stockLogoUrl(symbol: string): string {
  return `https://xstocks-metadata.backed.fi/logos/tokens/${symbol}.png`;
}

/**
 * Format a USD stock price for display.
 */
export function formatStockPrice(price?: number): string {
  if (price == null || price <= 0) return "—";
  if (price >= 100) return `$${price.toFixed(2)}`;
  if (price >= 1) return `$${price.toFixed(3)}`;
  return `$${price.toFixed(4)}`;
}
