/**
 * Jorkal NFT Data MCP Server
 *
 * Implements MCP (Model Context Protocol) over Streamable HTTP transport.
 * Exposes 17 tools backed by the x402 NFT & Crypto Data API:
 *   - nft_floor        — Floor price + listed count for a collection
 *   - nft_listings     — Top 10 cheapest listings
 *   - nft_stats        — Full collection stats
 *   - nft_activity     — Recent bids, listings, and sales for a collection
 *   - nft_token        — Single NFT detail + attributes
 *   - wallet_nfts      — NFTs owned by a Solana wallet
 *   - wallet_activity  — Wallet transaction history
 *   - wallet_value     — Estimated portfolio value
 *   - sol_balance      — SOL balance for a Solana wallet
 *   - token_balance    — SPL token balance (USDC, ORE, etc.)
 *   - eth_balance      — ETH or Base native balance
 *   - token_price      — Solana token price via Jupiter
 *   - erc20_balance    — ERC-20 token balance (Ethereum/Base)
 *   - ens_resolve      — ENS name resolve or reverse lookup
 *   - coin_price       — Multi-coin USD prices (BTC, ETH, SOL, etc.)
 *   - eth_transaction  — Ethereum/Base transaction details
 *   - sol_transaction  — Solana transaction details
 *
 * Payment: Each tool call costs a small amount of USDC on Base mainnet
 * via x402. Pass your x-payment header in the MCP request, OR set
 * X402_PAYMENT_HEADER env var for server-side payment (for testing).
 *
 * MCP endpoint: GET/POST /mcp  (Streamable HTTP transport)
 * MCP metadata: GET /mcp/info
 */

import express from 'express';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const API_BASE = process.env.API_BASE || 'https://vercel-deploy-alpha-puce.vercel.app';

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, mcp-session-id, x-payment, authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ── MCP Protocol Helpers ───────────────────────────────────────────────────────

const SERVER_INFO = {
  name: 'Solana NFT & Crypto Data API',
  version: '1.2.0',
  description: 'Real-time Solana NFT market data and multi-chain crypto tools — NFT floor prices, listings, collection stats, wallet portfolio, SOL/SPL/ETH/ERC-20 balances, ENS lookups, BTC/ETH/SOL prices, and transaction details. Powered by x402 micropayments on Base.',
};

const TOOLS = [
  {
    name: 'nft_floor',
    description: 'Get the floor price and listing count for a Magic Eden Solana NFT collection. Returns floor price in SOL and lamports, average 24h price, and total volume.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Magic Eden collection symbol (e.g. "degods", "okay_bears", "the_tower")',
        },
      },
      required: ['symbol'],
    },
    _price: '$0.001 USDC on Base mainnet',
  },
  {
    name: 'nft_listings',
    description: 'Get the cheapest active NFT listings for a Magic Eden Solana collection. Returns up to 20 listings sorted by price ascending.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Magic Eden collection symbol (e.g. "degods", "okay_bears")',
        },
        limit: {
          type: 'integer',
          description: 'Number of listings to return (1–20, default 10)',
          minimum: 1,
          maximum: 20,
        },
      },
      required: ['symbol'],
    },
    _price: '$0.002 USDC on Base mainnet',
  },
  {
    name: 'nft_stats',
    description: 'Get full collection stats for a Magic Eden Solana NFT collection: floor, volume, 24h avg, holders, supply.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Magic Eden collection symbol (e.g. "degods", "okay_bears")',
        },
      },
      required: ['symbol'],
    },
    _price: '$0.002 USDC on Base mainnet',
  },
  {
    name: 'wallet_nfts',
    description: 'Get NFTs owned by a Solana wallet address. Returns mint addresses, names, collections, and listing status.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Solana wallet address (base58)',
        },
        limit: {
          type: 'integer',
          description: 'Number of NFTs to return (1–50, default 20)',
          minimum: 1,
          maximum: 50,
        },
        offset: {
          type: 'integer',
          description: 'Pagination offset (default 0)',
          minimum: 0,
        },
      },
      required: ['address'],
    },
    _price: '$0.005 USDC on Base mainnet',
  },
  {
    name: 'nft_activity',
    description: 'Get recent activity for a Magic Eden Solana NFT collection — includes bids, listings, and sales with prices, buyers, sellers, and timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Magic Eden collection symbol (e.g. "degods", "okay_bears")',
        },
        limit: {
          type: 'integer',
          description: 'Number of activity events to return (1–50, default 20)',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['symbol'],
    },
    _price: '$0.002 USDC on Base mainnet',
  },
  {
    name: 'nft_token',
    description: 'Get detailed information about a single Solana NFT by its mint address — includes name, owner, collection, current listing price, image URL, and all on-chain attributes/traits.',
    inputSchema: {
      type: 'object',
      properties: {
        mint: {
          type: 'string',
          description: 'Solana token mint address (base58)',
        },
      },
      required: ['mint'],
    },
    _price: '$0.001 USDC on Base mainnet',
  },
  {
    name: 'wallet_activity',
    description: 'Get recent NFT transaction history for a Solana wallet — buys, sells, bids, and listings with prices, collections, and timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Solana wallet address (base58)',
        },
        limit: {
          type: 'integer',
          description: 'Number of activity events to return (1–50, default 20)',
          minimum: 1,
          maximum: 50,
        },
        offset: {
          type: 'integer',
          description: 'Pagination offset (default 0)',
          minimum: 0,
        },
      },
      required: ['address'],
    },
    _price: '$0.003 USDC on Base mainnet',
  },
  {
    name: 'wallet_value',
    description: 'Estimate the total NFT portfolio value for a Solana wallet using current floor prices. Returns a breakdown by collection with estimated value per collection and a grand total in SOL.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Solana wallet address (base58)',
        },
      },
      required: ['address'],
    },
    _price: '$0.010 USDC on Base mainnet',
  },
  {
    name: 'sol_balance',
    description: 'Get the SOL balance for any Solana wallet address. Returns the balance in both lamports (raw) and SOL (human-readable).',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Solana wallet address (base58)',
        },
      },
      required: ['address'],
    },
    _price: '$0.001 USDC on Base mainnet',
  },
  {
    name: 'token_balance',
    description: 'Get the SPL token balance for a Solana wallet. Works for any SPL token including USDC (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v), ORE, and others. Returns raw amount, decimals, and human-readable balance.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Solana wallet address (base58)',
        },
        mint: {
          type: 'string',
          description: 'SPL token mint address (base58). E.g. USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        },
      },
      required: ['address', 'mint'],
    },
    _price: '$0.001 USDC on Base mainnet',
  },
  {
    name: 'eth_balance',
    description: 'Get the native ETH or Base balance for an EVM wallet address. Supports both Ethereum mainnet and Base mainnet.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'EVM wallet address (0x-prefixed hex)',
        },
        chain: {
          type: 'string',
          description: 'Chain to query: "eth" for Ethereum mainnet, "base" for Base mainnet (default: "eth")',
          enum: ['eth', 'base'],
        },
      },
      required: ['address'],
    },
    _price: '$0.001 USDC on Base mainnet',
  },
  {
    name: 'token_price',
    description: 'Get the current USD price for any Solana token by its mint address. Uses Jupiter Price API. Works for SOL, USDC, ORE, JUP, and thousands of other Solana tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        mint: {
          type: 'string',
          description: 'Solana token mint address (base58). E.g. SOL: So11111111111111111111111111111111111111112, USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        },
      },
      required: ['mint'],
    },
    _price: '$0.001 USDC on Base mainnet',
  },
  {
    name: 'erc20_balance',
    description: 'Get the ERC-20 token balance for any EVM wallet on Ethereum or Base. Use shorthand names (usdc, usdt, dai, weth, wbtc) or any contract address.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'EVM wallet address (0x-prefixed)',
        },
        contract: {
          type: 'string',
          description: 'Token shorthand (usdc, usdt, dai, weth, wbtc) or full contract address (0x...)',
        },
        chain: {
          type: 'string',
          description: 'Chain: "eth" for Ethereum mainnet, "base" for Base mainnet (default: eth)',
          enum: ['eth', 'base'],
        },
      },
      required: ['address', 'contract'],
    },
    _price: '$0.001 USDC on Base mainnet',
  },
  {
    name: 'ens_resolve',
    description: 'Resolve an ENS name to an Ethereum address (e.g. "vitalik.eth" → 0x...), or reverse-lookup an address to its ENS name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'ENS name (e.g. "vitalik.eth") for forward lookup, or Ethereum address (0x...) for reverse lookup',
        },
      },
      required: ['name'],
    },
    _price: '$0.001 USDC on Base mainnet',
  },
  {
    name: 'coin_price',
    description: 'Get current USD prices for multiple cryptocurrencies. Supports BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, MATIC, LINK, SUI, JUP and more. Use common tickers or full CoinGecko IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'string',
          description: 'Comma-separated coin IDs or tickers. E.g. "btc,eth,sol" or "bitcoin,ethereum,solana" (default: bitcoin,ethereum,solana)',
        },
      },
      required: [],
    },
    _price: '$0.001 USDC on Base mainnet',
  },
  {
    name: 'eth_transaction',
    description: 'Get details for an Ethereum or Base transaction by hash — from/to addresses, value, gas used, status (success/failed/pending), and block.',
    inputSchema: {
      type: 'object',
      properties: {
        hash: {
          type: 'string',
          description: 'Transaction hash (0x-prefixed hex)',
        },
        chain: {
          type: 'string',
          description: 'Chain: "eth" for Ethereum mainnet, "base" for Base mainnet (default: eth)',
          enum: ['eth', 'base'],
        },
      },
      required: ['hash'],
    },
    _price: '$0.001 USDC on Base mainnet',
  },
  {
    name: 'sol_transaction',
    description: 'Get details for a Solana transaction by signature — slot, block time, status (success/failed), fee in SOL, involved accounts, and program logs.',
    inputSchema: {
      type: 'object',
      properties: {
        signature: {
          type: 'string',
          description: 'Solana transaction signature (base58)',
        },
      },
      required: ['signature'],
    },
    _price: '$0.001 USDC on Base mainnet',
  },
];

function jsonrpc(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonrpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

// ── API call helper with x402 forwarding ──────────────────────────────────────

async function callApi(path, paymentHeader) {
  const headers = {};
  if (paymentHeader) headers['x-payment'] = paymentHeader;

  const res = await fetch(`${API_BASE}${path}`, { headers });

  if (res.status === 402) {
    const paymentRequired = res.headers.get('payment-required') || res.headers.get('PAYMENT-REQUIRED');
    return {
      error: 'payment_required',
      status: 402,
      paymentRequired,
      message: 'Payment required. Pass an x402 payment header with your tool call. See payment_info for details.',
      payment_info: {
        description: 'Pay with USDC on Base mainnet (eip155:8453) via x402 protocol',
        amount: 'See tool description for price',
        payTo: '0xA63A9cB0adc792a2913307Be577CBeF86E8756B6',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        docs: 'https://x402.org',
      },
    };
  }

  if (!res.ok) {
    return { error: 'api_error', status: res.status, message: await res.text() };
  }

  return await res.json();
}

// ── Tool dispatch ──────────────────────────────────────────────────────────────

async function callTool(name, args, paymentHeader) {
  switch (name) {
    case 'nft_floor': {
      const { symbol } = args;
      if (!symbol) throw new Error('symbol is required');
      const data = await callApi(`/floor/${encodeURIComponent(symbol)}`, paymentHeader);
      return data;
    }
    case 'nft_listings': {
      const { symbol, limit = 10 } = args;
      if (!symbol) throw new Error('symbol is required');
      const data = await callApi(`/listings/${encodeURIComponent(symbol)}?limit=${limit}`, paymentHeader);
      return data;
    }
    case 'nft_stats': {
      const { symbol } = args;
      if (!symbol) throw new Error('symbol is required');
      const data = await callApi(`/stats/${encodeURIComponent(symbol)}`, paymentHeader);
      return data;
    }
    case 'wallet_nfts': {
      const { address, limit = 20, offset = 0 } = args;
      if (!address) throw new Error('address is required');
      const data = await callApi(`/wallet/${encodeURIComponent(address)}/nfts?limit=${limit}&offset=${offset}`, paymentHeader);
      return data;
    }
    case 'nft_activity': {
      const { symbol, limit = 20 } = args;
      if (!symbol) throw new Error('symbol is required');
      const data = await callApi(`/activity/${encodeURIComponent(symbol)}?limit=${limit}`, paymentHeader);
      return data;
    }
    case 'nft_token': {
      const { mint } = args;
      if (!mint) throw new Error('mint is required');
      const data = await callApi(`/token/${encodeURIComponent(mint)}`, paymentHeader);
      return data;
    }
    case 'wallet_activity': {
      const { address, limit = 20, offset = 0 } = args;
      if (!address) throw new Error('address is required');
      const data = await callApi(`/wallet/${encodeURIComponent(address)}/activity?limit=${limit}&offset=${offset}`, paymentHeader);
      return data;
    }
    case 'wallet_value': {
      const { address } = args;
      if (!address) throw new Error('address is required');
      const data = await callApi(`/wallet/${encodeURIComponent(address)}/value`, paymentHeader);
      return data;
    }
    case 'sol_balance': {
      const { address } = args;
      if (!address) throw new Error('address is required');
      const data = await callApi(`/balance/sol/${encodeURIComponent(address)}`, paymentHeader);
      return data;
    }
    case 'token_balance': {
      const { address, mint } = args;
      if (!address) throw new Error('address is required');
      if (!mint) throw new Error('mint is required');
      const data = await callApi(`/balance/spl/${encodeURIComponent(address)}/${encodeURIComponent(mint)}`, paymentHeader);
      return data;
    }
    case 'eth_balance': {
      const { address, chain = 'eth' } = args;
      if (!address) throw new Error('address is required');
      const data = await callApi(`/balance/eth/${encodeURIComponent(address)}?chain=${chain}`, paymentHeader);
      return data;
    }
    case 'token_price': {
      const { mint } = args;
      if (!mint) throw new Error('mint is required');
      const data = await callApi(`/price/token/${encodeURIComponent(mint)}`, paymentHeader);
      return data;
    }
    case 'erc20_balance': {
      const { address, contract, chain = 'eth' } = args;
      if (!address) throw new Error('address is required');
      if (!contract) throw new Error('contract is required');
      const data = await callApi(`/balance/erc20/${encodeURIComponent(address)}/${encodeURIComponent(contract)}?chain=${chain}`, paymentHeader);
      return data;
    }
    case 'ens_resolve': {
      const { name } = args;
      if (!name) throw new Error('name is required');
      const data = await callApi(`/ens/${encodeURIComponent(name)}`, paymentHeader);
      return data;
    }
    case 'coin_price': {
      const { ids = 'bitcoin,ethereum,solana' } = args;
      const data = await callApi(`/price/coins?ids=${encodeURIComponent(ids)}`, paymentHeader);
      return data;
    }
    case 'eth_transaction': {
      const { hash, chain = 'eth' } = args;
      if (!hash) throw new Error('hash is required');
      const data = await callApi(`/tx/eth/${encodeURIComponent(hash)}?chain=${chain}`, paymentHeader);
      return data;
    }
    case 'sol_transaction': {
      const { signature } = args;
      if (!signature) throw new Error('signature is required');
      const data = await callApi(`/tx/sol/${encodeURIComponent(signature)}`, paymentHeader);
      return data;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Session store (in-memory, stateless Vercel functions will skip this) ──────

const sessions = new Map();

// ── Shared message handler (used by both HTTP and stdio transports) ───────────

async function handleMcpMessage(msg, paymentHeader) {
  const { jsonrpc: ver, id, method, params } = msg;

  if (ver !== '2.0') {
    return jsonrpcError(id, -32600, 'Invalid JSON-RPC version');
  }

  try {
    switch (method) {
      case 'initialize': {
        const sessionId = crypto.randomUUID();
        sessions.set(sessionId, { created: Date.now() });
        return jsonrpc(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      }

      case 'tools/list': {
        return jsonrpc(id, {
          tools: TOOLS.map(({ _price, ...t }) => t),
        });
      }

      case 'tools/call': {
        const { name, arguments: args } = params;
        const metaPayment = params._meta?.payment;
        const effectivePayment = metaPayment || paymentHeader;

        try {
          const result = await callTool(name, args || {}, effectivePayment);

          if (result?.error === 'payment_required') {
            return jsonrpc(id, {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  error: 'payment_required',
                  message: result.message,
                  payment_info: result.payment_info,
                  payment_required_header: result.paymentRequired,
                  instructions: [
                    '1. Decode the payment_required_header (base64) to get payment details',
                    '2. Sign an EIP-3009 TransferWithAuthorization for the required USDC amount',
                    '3. Encode the signature as the x-payment header',
                    '4. Retry the tool call with _meta.payment set to the signed header',
                    'See https://x402.org for the x402 payment protocol spec',
                  ],
                }, null, 2),
              }],
              isError: true,
            });
          } else if (result?.error) {
            return jsonrpc(id, {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              isError: true,
            });
          } else {
            return jsonrpc(id, {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            });
          }
        } catch (e) {
          return jsonrpcError(id, -32000, e.message);
        }
      }

      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null; // Notifications — no response

      default:
        return jsonrpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return jsonrpcError(id, -32603, 'Internal error', e.message);
  }
}

// ── MCP endpoint ──────────────────────────────────────────────────────────────

app.get('/mcp/info', (req, res) => {
  res.json({
    ...SERVER_INFO,
    transport: 'streamable-http',
    endpoint: `${req.protocol}://${req.headers.host}/mcp`,
    tools: TOOLS.map(t => ({ name: t.name, description: t.description, price: t._price })),
    payment: {
      protocol: 'x402',
      network: 'eip155:8453 (Base mainnet)',
      asset: 'USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)',
      payTo: '0xA63A9cB0adc792a2913307Be577CBeF86E8756B6',
      instructions: 'Include x-payment header in MCP request meta, or pass payment header via tool call arguments.',
    },
  });
});

// MCP Streamable HTTP: POST for client→server messages
app.post('/mcp', async (req, res) => {
  const body = req.body;
  const messages = Array.isArray(body) ? body : [body];
  const paymentHeader = req.headers['x-payment'];

  const responses = [];
  for (const msg of messages) {
    // Set session header on initialize
    if (msg.method === 'initialize') {
      res.setHeader('mcp-session-id', crypto.randomUUID());
    }
    const result = await handleMcpMessage(msg, paymentHeader);
    if (result !== null) responses.push(result);
  }

  const toSend = responses.filter(Boolean);
  if (toSend.length === 0) return res.status(202).end();
  res.json(toSend.length === 1 ? toSend[0] : toSend);
});

// MCP Streamable HTTP: GET for server→client SSE streams (optional)
app.get('/mcp', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Immediately close with a message — we're stateless
  res.write('data: {"type":"connected"}\n\n');
  res.end();
});

// ── Free info endpoint ────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    name: SERVER_INFO.name,
    description: SERVER_INFO.description,
    mcp_endpoint: `${req.protocol}://${req.headers.host}/mcp`,
    mcp_info: `${req.protocol}://${req.headers.host}/mcp/info`,
    tools: TOOLS.map(t => ({ name: t.name, price: t._price, description: t.description })),
  });
});

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── Start ─────────────────────────────────────────────────────────────────────

// Use HTTP when running on Vercel (VERCEL env var is set), or when stdin is a TTY.
// Use stdio only when stdin is piped AND we're not on Vercel (e.g. mcp-proxy / Glama).
if (!process.stdin.isTTY && !process.env.VERCEL) {
  // Stdio transport — used by mcp-proxy and local MCP clients (e.g. Glama inspection)
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop(); // Keep incomplete line in buffer
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        const msgs = Array.isArray(msg) ? msg : [msg];
        for (const m of msgs) {
          const result = await handleMcpMessage(m, null);
          if (result !== null) {
            process.stdout.write(JSON.stringify(result) + '\n');
          }
        }
      } catch {
        // Ignore non-JSON input
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
} else {
  // HTTP transport — default mode for Vercel and direct usage
  app.listen(PORT, () => {
    console.log(`Jorkal NFT MCP Server running on port ${PORT}`);
    console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  });
}
