# VeloRail

VeloRail is an intent-driven financial gateway deployed entirely inside a native Telegram Bot interface. Designed specifically for low-bandwidth mobile environments, it relies on structured text and voice commands instead of webviews or custom graphical frontends. The backend parses unstructured user inputs into schema-compliant financial payloads, manages transaction states in memory, and simulates banking settlement using the ISO 20022 standard.

---

## Architectural Workflow

The application operates as an event-driven system:

1. **Ingestion**: The bot intercepts text messages or native voice notes (under 50KB).
2. **Transcription**: If a voice note is received, the bot verifies its duration and size limits. It then either uses OpenAI's Whisper API to transcribe the audio or falls back to a development mock transcription text when API credentials are absent.
3. **Intent Parsing**: The transcribed text is sent to Google's Gemini 2.5 Flash model with a strict JSON schema. Running at a low temperature of 0.1, the engine extracts transaction details (action, amount, currency, recipient, and reference) into a normalized structure with zero conversational filler.
4. **Session Management**: Pending intents are cached in memory using a global session store map keyed by Telegram User ID, enforcing a 5-minute time-to-live (TTL).
5. **Preview**: The user is presented with a Markdown summary of the transaction along with inline keyboards for confirmation or cancellation.
6. **Settlement**: Upon confirmation, the gateway generates a unique reference token, maps the parameters to a simulated ISO 20022 message block (pain.001.001.09), computes gateway vs. traditional fee differences, outputs a flat Markdown receipt, and clears the user's session cache.

---

## Directory Structure

```
velorail/
├── src/
│   ├── types.ts         - TypeScript interfaces for intents and sessions
│   ├── session.ts       - In-memory session store with TTL invalidation
│   ├── intentParser.ts  - Gemini SDK client and JSON schema configuration
│   ├── transcribe.ts    - Voice downloader and Whisper integration handler
│   ├── settler.ts       - ISO 20022 payload formatting and fee calculation
│   └── server.ts        - grammY bot initialization, commands, and listeners
├── .env.example         - Environment configuration template
├── package.json         - Runtime dependencies and execution scripts
├── tsconfig.json        - TypeScript compiler configurations
└── README.md            - Technical documentation and guide
```

---

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **Telegram Bot Framework**: grammY
- **Generative AI Layer**: `@google/genai` (Gemini 2.5 Flash)
- **HTTP Client**: axios
- **Multipart Form Data**: form-data
- **Environment Variables**: dotenv

---

## Configuration Setup

Before running the application, copy the example environment file:
```bash
cp .env.example .env
```

Open the `.env` file and configure the following variables:

- `TELEGRAM_BOT_TOKEN`: The API token obtained from Telegram's BotFather.
- `GEMINI_API_KEY`: API Key for the Google Gemini Developer API.
- `OPENAI_API_KEY`: (Optional) OpenAI API Key. If left blank, the bot runs in mock transcription mode for voice notes.
- `MOCK_TRANSCRIPTION_TEXT`: The fallback text returned during mock transcription tests.
- `MAX_VOICE_SECONDS`: The maximum duration allowed for incoming voice notes (defaults to 30).
- `EVM_RPC_URL`: Node RPC URL for Somnia Testnet (`https://api.infra.testnet.somnia.network`).
- `BOT_PRIVATE_KEY`: Secret key used by the bot to sign and broadcast native STT transactions.
- `BLOCK_EXPLORER_URL`: Somnia Testnet Explorer transaction prefix (`https://explorer-testnet.somnia.network/tx/`).

> [!WARNING]
> **Wallet Private Key Security**:
> The `BOT_PRIVATE_KEY` should be a dedicated testnet bot wallet containing ONLY testnet funds (e.g. Somnia STT Testnet tokens). Never configure this variable with a private key belonging to a wallet containing real mainnet assets.

---

## Scripts and Execution

All tasks can be managed using standard npm scripts:

### Dependency Installation
```bash
npm install
```

### Static Type Checking
Run the TypeScript compiler without generating output files to check for type errors:
```bash
npm run typecheck
```

### Development Mode
Runs the bot in real-time using ts-node:
```bash
npm run dev
```

### Production Compilation and Start
Compile the TypeScript code to JavaScript and run the server from the distribution directory:
```bash
npm run build
npm start
```

---

## Fee Comparison Matrix

VeloRail integrates live gas fees to compare blockchain cost-efficiency relative to traditional settlement models:
- **Traditional Bank Model**: Flat $35.00 fee plus 0.50% transaction amount.
- **VeloRail Gateway Model**: The actual transaction gas fee in native STT tokens on Somnia Testnet, estimated on-chain during dry-run.

During settlement, these numbers are generated dynamically and appended to the final receipt.

---

## Roadmap

The current version of VeloRail is optimized as a lightweight hackathon demo executing native transfers on Somnia Testnet. Future releases will expand on:
1. **ERC-20 Token Mappings**: Support for stablecoins (USDC, USDT) and utility tokens mapped to their respective contract addresses.
2. **Multi-Chain Routing**: Integrating cross-chain bridges to route user intents across Polygon, Base, Arbitrum, and Ethereum.
3. **Developer Fee Routing**: Redirecting protocol fees to a secure multisig developer treasury address automatically.
4. **Custodial Wallet Services**: Integrating enterprise wallet APIs (e.g., Circle, Fireblocks, Coinbase Developer Platform) to let institutional clients use the interface.

