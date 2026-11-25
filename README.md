# Echo-Mint (EzyNFT Studio)

**AI-to-NEAR NFT Studio with Conversational Minting, IPFS Pinning & On-Chain Prompt Provenance.**

* **Live Frontend:** https://sakura-hack01.github.io/Echo-Mint/
* **Backend API:** https://echo-mint.onrender.com

---

## Overview

Echo-Mint turns NFT creation into a guided conversation. Users connect a **NEAR Wallet** (or explore via **Demo Mode**), chat with the **EzyNFT Assistant** to brainstorm and generate artwork, pin the image and metadata to **IPFS via Pinata**, and mint directly on **NEAR Protocol** (`NEP-171` / `NEP-177`) with the AI prompt provenance stored on-chain.

## Architecture

| Component | Path | Details |
| :--- | :--- | :--- |
| **Smart Contract** | [`contract/src/contract.ts`](contract/src/contract.ts) | `EzyNFTContract` (`near-sdk-js`) implementing `nft_mint`, `nft_token`, `nft_tokens`, `nft_tokens_for_owner`, `nft_transfer`, automatic excess storage deposit refunds, and prompt provenance in `token_metadata.extra`. |
| **Backend API** | [`backend/index.js`](backend/index.js) | Zero-dependency Node.js HTTP server (`>=18`) supporting Gemini, OpenAI, Hugging Face, Stability AI, and Pinata IPFS pinning with automatic multi-provider fallback and built-in procedural SVG art demo mode. |
| **Frontend Studio** | [`frontend/index.html`](frontend/index.html), [`frontend/index.js`](frontend/index.js) | Parcel web app using `@near-wallet-selector` (MyNearWallet, Ledger), a floating AI chatbot, Live NFT Draft preview, and on-chain Minted NFTs gallery. |
| **Integration Tests** | [`integration-tests/src/main.ava.ts`](integration-tests/src/main.ava.ts) | AVA + `near-workspaces` sandbox tests for `nft_metadata`, `nft_mint`, `nft_tokens_for_owner`, and `nft_transfer`. |

---

## Quick Start (Local Development)

### 1. Configure Backend Environment
Copy [`backend/.env.example`](backend/.env.example) to `backend/.env` and add any optional API keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `HF_API_KEY`, `STABILITY_API_KEY`, `PINATA_JWT`). Without keys, the backend runs in built-in demo mode.

```bash
npm run backend
```

### 2. Run Frontend
```bash
cd frontend
npm install
npm run dev
```

### 3. Build, Test & Deploy the NEAR Contract
```bash
cd contract
npm install
npx near-sdk-js build src/contract.ts build/contract.wasm
npx near login
npx near deploy YOUR_CONTRACT.testnet build/contract.wasm
npx near call YOUR_CONTRACT.testnet init "{}" --accountId YOUR_CONTRACT.testnet
```

---

## Deployment

* **Backend (Render):** Deploy [`backend/`](backend/) as a Node Web Service (`npm install; npm run build` / `npm start`) with your environment variables.
* **Frontend (GitHub Pages):** [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) builds `frontend/dist` and deploys to GitHub Pages on push to `main` using `BACKEND_URL` and `CONTRACT_NAME` Actions variables.

## License

Licensed under the [Apache License 2.0](LICENSE).
