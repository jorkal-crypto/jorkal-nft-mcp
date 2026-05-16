# Jorkal NFT Data — MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server for real-time Solana NFT market data from Magic Eden.

## MCP Endpoint

```
https://jorkal-nft-mcp.vercel.app/mcp
```

Compatible with any MCP client (Claude, Cursor, Windsurf, etc.).

## Tools

| Tool | Description | Price |
|------|-------------|-------|
| `nft_floor` | Floor price + listing count for a collection | $0.001 USDC |
| `nft_listings` | Top cheapest active listings | $0.002 USDC |
| `nft_stats` | Full collection stats (volume, holders, supply) | $0.002 USDC |
| `wallet_nfts` | All NFTs owned by a Solana wallet | $0.005 USDC |

## Usage

### With Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jorkal-nft": {
      "url": "https://jorkal-nft-mcp.vercel.app/mcp"
    }
  }
}
```

Then ask Claude: _"What is the floor price of degods?"_

### Direct MCP call

```bash
curl -X POST https://jorkal-nft-mcp.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"nft_floor","arguments":{"symbol":"degods"}}}'
```

## Payment

Tools are paid via the [x402 protocol](https://x402.org) — micropayments in USDC on Base mainnet. When a payment is required, the tool returns instructions on how to pay.

- Network: Base mainnet (eip155:8453)
- Asset: USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- Pay to: `0xA63A9cB0adc792a2913307Be577CBeF86E8756B6`

## Available Collections

Works with any Magic Eden Solana collection. Examples: `degods`, `okay_bears`, `the_tower`, `y00ts`, `mad_lads`.

## x402 HTTP API

Also available as a direct x402-compatible HTTP API:

- Base URL: `https://vercel-deploy-alpha-puce.vercel.app`
- Listed on [x402scan](https://www.x402scan.com/server/8c591070-fcf5-4f18-becb-e829c1f42640)

## License

MIT
