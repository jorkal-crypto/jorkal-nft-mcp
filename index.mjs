/**
 * Jorkal NFT Data MCP Server
 *
 * Implements MCP (Model Context Protocol) over Streamable HTTP transport.
 * Exposes 8 tools backed by the x402 NFT Data API:
 *   - nft_floor        — Floor price + listed count for a collection
 *   - nft_listings     — Top 10 cheapest listings
 *   - nft_stats        — Full collection stats
 *   - nft_activity     — Recent bids, listings, and sales for a collection
 *   - nft_token        — Single NFT detail + attributes
 *   - wallet_nfts      — NFTs owned by a Solana wallet
 *   - wallet_activity  — Wallet transaction history
 *   - wallet_value     — Estimated portfolio value
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
  name: 'Solana NFT Data API',
  version: '1.0.0',
  description: 'Real-time Solana NFT market data via Magic Eden — floor prices, listings, collection stats, recent activity, token details, and wallet portfolio analysis. Powered by x402 micropayments on Base.',
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
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Session store (in-memory, stateless Vercel functions will skip this) ──────

const sessions = new Map();

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

  // Support batch (array) or single message
  const messages = Array.isArray(body) ? body : [body];
  const responses = [];

  // Forward x-payment header from MCP request meta or HTTP header
  const paymentHeader = req.headers['x-payment'];

  for (const msg of messages) {
    const { jsonrpc: ver, id, method, params } = msg;

    if (ver !== '2.0') {
      responses.push(jsonrpcError(id, -32600, 'Invalid JSON-RPC version'));
      continue;
    }

    try {
      switch (method) {
        case 'initialize': {
          const sessionId = crypto.randomUUID();
          sessions.set(sessionId, { created: Date.now() });
          res.setHeader('mcp-session-id', sessionId);
          responses.push(jsonrpc(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          }));
          break;
        }

        case 'tools/list': {
          responses.push(jsonrpc(id, {
            tools: TOOLS.map(({ _price, ...t }) => t),
          }));
          break;
        }

        case 'tools/call': {
          const { name, arguments: args } = params;
          // Check for payment in params._meta or HTTP header
          const metaPayment = params._meta?.payment;
          const effectivePayment = metaPayment || paymentHeader;

          try {
            const result = await callTool(name, args || {}, effectivePayment);

            if (result?.error === 'payment_required') {
              // Return payment required as a structured tool result
              responses.push(jsonrpc(id, {
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
              }));
            } else if (result?.error) {
              responses.push(jsonrpc(id, {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                isError: true,
              }));
            } else {
              responses.push(jsonrpc(id, {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              }));
            }
          } catch (e) {
            responses.push(jsonrpcError(id, -32000, e.message));
          }
          break;
        }

        case 'notifications/initialized':
        case 'notifications/cancelled': {
          // Notifications — no response needed
          break;
        }

        default:
          responses.push(jsonrpcError(id, -32601, `Method not found: ${method}`));
      }
    } catch (e) {
      responses.push(jsonrpcError(id, -32603, 'Internal error', e.message));
    }
  }

  // Filter out nulls (notifications with no response)
  const toSend = responses.filter(Boolean);

  if (toSend.length === 0) {
    return res.status(202).end();
  }

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

app.listen(PORT, () => {
  console.log(`Jorkal NFT MCP Server running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
