import 'regenerator-runtime/runtime';
import { Wallet } from './near-wallet';

const CONTRACT_ADDRESS = process.env.CONTRACT_NAME || '';
const isLocalHost =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
const BACKEND_URL =
  process.env.BACKEND_URL ||
  (isLocalHost ? 'http://localhost:3001' : 'https://echo-mint.onrender.com');
const MINT_DEPOSIT_YOCTO = '50000000000000000000000'; // 0.05 NEAR (excess auto-refunded by contract)

const wallet = new Wallet({
  createAccessKeyFor: CONTRACT_ADDRESS || undefined,
});

const state = {
  demoMode: false,
  accountId: null,
  chatHistory: [],
  draft: {
    prompt: '',
    style: 'Digital Collectible',
    title: '',
    description: '',
    imageDataUrl: '',
    imageProvider: '',
    ipfsUri: '',
    metadataIpfsUri: '',
    gatewayUrl: '',
  },
  demoMints: [],
};

// DOM references
const el = {
  signedOut: document.querySelector('#signed-out-flow'),
  signedIn: document.querySelector('#signed-in-flow'),
  signInBtn: document.querySelector('#sign-in-button'),
  demoModeBtn: document.querySelector('#demo-mode-button'),
  signOutBtn: document.querySelector('#sign-out-button'),
  pillChat: document.querySelector('#pill-chat'),
  pillImage: document.querySelector('#pill-image'),
  pillIpfs: document.querySelector('#pill-ipfs'),
  pillContract: document.querySelector('#pill-contract'),
  draftPrompt: document.querySelector('#draft-prompt'),
  draftTitle: document.querySelector('#draft-title'),
  draftStyle: document.querySelector('#draft-style'),
  draftDesc: document.querySelector('#draft-description'),
  draftBadge: document.querySelector('#draft-source-badge'),
  previewEmpty: document.querySelector('#nft-preview-empty'),
  previewImg: document.querySelector('#nft-preview-img'),
  provenanceBox: document.querySelector('#provenance-box'),
  provenanceSummary: document.querySelector('#provenance-summary'),
  generateArtBtn: document.querySelector('#generate-art-btn'),
  pinIpfsBtn: document.querySelector('#pin-ipfs-btn'),
  mintNftBtn: document.querySelector('#mint-nft-btn'),
  mintStatus: document.querySelector('#mint-status'),
  nftDraftForm: document.querySelector('#nft-draft-form'),
  nftGallery: document.querySelector('#nft-gallery'),
  refreshGalleryBtn: document.querySelector('#refresh-gallery-btn'),
  chatPanel: document.querySelector('#ezy-chat-panel'),
  chatLauncher: document.querySelector('#ezy-chat-launcher'),
  chatClose: document.querySelector('#ezy-chat-close'),
  chatOpenCta: document.querySelector('#open-chat-cta'),
  chatMessages: document.querySelector('#ezy-chat-messages'),
  chatForm: document.querySelector('#ezy-chat-form'),
  chatInput: document.querySelector('#ezy-chat-input'),
};

window.onload = async () => {
  try {
    const isSignedIn = await wallet.startUp();
    if (isSignedIn) {
      state.accountId = wallet.accountId;
      enterStudio();
      return;
    }
  } catch (err) {
    console.warn('Wallet startup check failed:', err);
  }
  showSignedOut();
};

el.signInBtn.onclick = () => wallet.signIn();
el.demoModeBtn.onclick = () => {
  state.demoMode = true;
  state.accountId = 'demo-creator.testnet';
  enterStudio();
};
el.signOutBtn.onclick = () => {
  if (state.demoMode) {
    state.demoMode = false;
    state.accountId = null;
    showSignedOut();
  } else {
    wallet.signOut();
  }
};

function showSignedOut() {
  el.signedIn.style.display = 'none';
  el.signedOut.style.display = 'block';
}

function enterStudio() {
  el.signedOut.style.display = 'none';
  el.signedIn.style.display = 'block';
  document.querySelectorAll('[data-behavior=account-id]').forEach((node) => {
    node.innerText = state.accountId;
  });

  if (state.chatHistory.length === 0) {
    appendChatMessage(
      'assistant',
      `Hey ${state.accountId}! Tell me what NFT you want to create (e.g. "Create a neon cyberpunk lotus"), or ask me about NEAR & IPFS.`
    );
  }

  checkBackendStatus();
  loadGallery();
}

async function checkBackendStatus() {
  el.pillContract.textContent = CONTRACT_ADDRESS
    ? `Contract: ${CONTRACT_ADDRESS}`
    : 'Contract: demo mode';
  if (CONTRACT_ADDRESS) el.pillContract.classList.add('is-live');

  try {
    const res = await fetch(`${BACKEND_URL}/api/status`);
    const data = await res.json();
    if (data?.providers) {
      el.pillChat.textContent = `AI: ${data.providers.chat}`;
      el.pillImage.textContent = `Art: ${data.providers.image}`;
      el.pillIpfs.textContent = `IPFS: ${data.providers.ipfs}`;
      [el.pillChat, el.pillImage, el.pillIpfs].forEach((p) =>
        p.classList.add('is-live')
      );
    }
  } catch {
    el.pillChat.textContent = 'AI: offline (start backend)';
    el.pillImage.textContent = 'Art: offline';
    el.pillIpfs.textContent = 'IPFS: offline';
  }
}

// Chat widget controls
function toggleChat(open) {
  el.chatPanel.style.display = open ? 'flex' : 'none';
  if (open) el.chatInput.focus();
}

el.chatLauncher.onclick = () => {
  const isHidden = el.chatPanel.style.display === 'none';
  toggleChat(isHidden);
};
el.chatClose.onclick = () => toggleChat(false);
el.chatOpenCta.onclick = () => toggleChat(true);

document.querySelectorAll('.chip-btn').forEach((btn) => {
  btn.onclick = () => {
    const prompt = btn.getAttribute('data-prompt');
    if (prompt) sendChatMessage(prompt);
  };
});

el.chatForm.onsubmit = (e) => {
  e.preventDefault();
  const text = el.chatInput.value.trim();
  if (!text) return;
  el.chatInput.value = '';
  sendChatMessage(text);
};

function appendChatMessage(role, text, imageUrl = null) {
  state.chatHistory.push({ role, content: text });
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text;
  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = 'Generated NFT preview';
    bubble.appendChild(img);
  }
  el.chatMessages.appendChild(bubble);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  return bubble;
}

async function sendChatMessage(text) {
  toggleChat(true);
  appendChatMessage('user', text);
  const thinking = appendChatMessage('assistant', 'Thinking...');
  state.chatHistory.pop(); // don't persist placeholder in history

  try {
    const res = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: state.chatHistory,
        accountId: state.accountId,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Chat request failed');

    thinking.textContent = data.reply;
    state.chatHistory.push({ role: 'assistant', content: data.reply });

    if (data.draft && data.draft.shouldGenerateImage) {
      el.draftPrompt.value = data.draft.imagePrompt || text;
      el.draftTitle.value = data.draft.title || 'EzyNFT Creation';
      el.draftDesc.value = data.draft.description || '';
      el.draftStyle.value = data.draft.style || 'Digital Collectible';

      const art = await generateArtwork(
        el.draftPrompt.value,
        el.draftStyle.value
      );
      if (art?.imageDataUrl) {
        const img = document.createElement('img');
        img.src = art.imageDataUrl;
        img.alt = el.draftTitle.value;
        thinking.appendChild(img);
      }
    }
  } catch (err) {
    thinking.textContent = `Could not reach EzyNFT backend (${err.message}). Make sure "node backend/index.js" is running on ${BACKEND_URL}.`;
  }
}

el.generateArtBtn.onclick = async () => {
  const prompt = el.draftPrompt.value.trim();
  if (!prompt) {
    el.mintStatus.textContent = 'Enter an AI prompt first.';
    return;
  }
  await generateArtwork(prompt, el.draftStyle.value.trim());
};

async function generateArtwork(prompt, style) {
  el.generateArtBtn.disabled = true;
  el.mintStatus.textContent = 'Generating artwork...';
  try {
    const res = await fetch(`${BACKEND_URL}/api/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, style }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Image generation failed');

    state.draft.prompt = prompt;
    state.draft.style = style;
    state.draft.imageDataUrl = data.imageDataUrl;
    state.draft.imageProvider = data.provider;
    state.draft.ipfsUri = '';
    state.draft.metadataIpfsUri = '';

    if (!el.draftTitle.value.trim()) {
      el.draftTitle.value = prompt.split(/\s+/).slice(0, 4).join(' ');
    }
    if (!el.draftDesc.value.trim()) {
      el.draftDesc.value = `Co-created in EzyNFT Studio from prompt: "${prompt}"`;
    }

    el.previewImg.src = data.imageDataUrl;
    el.previewImg.style.display = 'block';
    el.previewEmpty.style.display = 'none';
    el.draftBadge.textContent = `Generated (${data.provider})`;
    el.provenanceBox.style.display = 'block';
    el.provenanceSummary.textContent = `"${prompt}" via ${data.provider}`;
    el.mintNftBtn.disabled = false;
    el.mintStatus.textContent = 'Artwork ready! Pin to IPFS or Mint directly on NEAR.';
    return data;
  } catch (err) {
    el.mintStatus.textContent = `Artwork generation error: ${err.message}`;
    return null;
  } finally {
    el.generateArtBtn.disabled = false;
  }
}

el.pinIpfsBtn.onclick = async () => {
  if (!state.draft.imageDataUrl) {
    el.mintStatus.textContent = 'Generate artwork before pinning to IPFS.';
    return;
  }
  await pinCurrentDraftToIpfs();
};

async function pinCurrentDraftToIpfs() {
  el.pinIpfsBtn.disabled = true;
  el.mintStatus.textContent = 'Pinning artwork & metadata to IPFS...';
  try {
    const provenance = {
      prompt: el.draftPrompt.value.trim(),
      style: el.draftStyle.value.trim(),
      model: state.draft.imageProvider,
      creator: state.accountId,
      createdAt: new Date().toISOString(),
    };
    const res = await fetch(`${BACKEND_URL}/api/pin-ipfs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageDataUrl: state.draft.imageDataUrl,
        title: el.draftTitle.value.trim() || 'EzyNFT Creation',
        description: el.draftDesc.value.trim(),
        provenance,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'IPFS pin failed');

    state.draft.ipfsUri = data.imageIpfsUri;
    state.draft.metadataIpfsUri = data.metadataIpfsUri || '';
    state.draft.gatewayUrl = data.imageGatewayUrl;

    if (data.pinMode === 'pinata') {
      el.mintStatus.textContent = 'Pinned to IPFS! Image CID: ';
      const code = document.createElement('code');
      code.textContent = data.imageCid;
      el.mintStatus.appendChild(code);
    } else {
      el.mintStatus.textContent = data.message || 'Ready for preview mint.';
    }
    return data;
  } catch (err) {
    el.mintStatus.textContent = `IPFS error: ${err.message}`;
    return null;
  } finally {
    el.pinIpfsBtn.disabled = false;
  }
}

el.nftDraftForm.onsubmit = async (e) => {
  e.preventDefault();
  if (!state.draft.imageDataUrl) return;

  el.mintNftBtn.disabled = true;
  try {
    if (!state.draft.ipfsUri) {
      await pinCurrentDraftToIpfs();
    }

    const title = el.draftTitle.value.trim() || 'EzyNFT Creation';
    const description = el.draftDesc.value.trim() || 'Minted with EzyNFT';
    const media = state.draft.gatewayUrl || state.draft.imageDataUrl;
    const provenance = JSON.stringify({
      prompt: el.draftPrompt.value.trim(),
      style: el.draftStyle.value.trim(),
      model: state.draft.imageProvider,
      generator: 'EzyNFT Studio',
      createdAt: new Date().toISOString(),
    });

    if (state.demoMode || !CONTRACT_ADDRESS) {
      const demoToken = {
        token_id: `demo-${state.demoMints.length + 1}`,
        owner_id: state.accountId,
        metadata: {
          title,
          description,
          media,
          extra: provenance,
          reference: state.draft.metadataIpfsUri || null,
        },
      };
      state.demoMints.unshift(demoToken);
      el.mintStatus.textContent = `Demo minted ${demoToken.token_id}! Deploy the NEAR contract and sign in with NEAR Wallet to mint on-chain.`;
      loadGallery();
      return;
    }

    el.mintStatus.textContent = 'Confirm transaction in your NEAR Wallet...';
    const { result, transactionHash } = await wallet.callMethod({
      contractId: CONTRACT_ADDRESS,
      method: 'nft_mint',
      args: {
        receiver_id: state.accountId,
        token_metadata: {
          title,
          description,
          media,
          reference: state.draft.metadataIpfsUri || null,
          extra: provenance,
        },
      },
      deposit: MINT_DEPOSIT_YOCTO,
    });

    const tokenId = result?.token_id || 'NFT';
    el.mintStatus.textContent = '';
    const msgPrefix = document.createTextNode('Minted ');
    const strong = document.createElement('strong');
    strong.textContent = tokenId;
    el.mintStatus.appendChild(msgPrefix);
    el.mintStatus.appendChild(strong);
    if (transactionHash) {
      el.mintStatus.appendChild(document.createTextNode('! '));
      const link = document.createElement('a');
      link.href = `https://testnet.nearblocks.io/txns/${encodeURIComponent(transactionHash)}`;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = 'View on NearBlocks';
      el.mintStatus.appendChild(link);
    } else {
      el.mintStatus.appendChild(document.createTextNode(' on NEAR!'));
    }
    await loadGallery();
  } catch (err) {
    el.mintStatus.textContent = `Minting failed: ${err.message}`;
  } finally {
    el.mintNftBtn.disabled = false;
  }
};

el.refreshGalleryBtn.onclick = () => loadGallery();

async function loadGallery() {
  let tokens = [...state.demoMints];
  if (!state.demoMode && CONTRACT_ADDRESS && state.accountId) {
    try {
      const onChain = await wallet.viewMethod({
        contractId: CONTRACT_ADDRESS,
        method: 'nft_tokens_for_owner',
        args: { account_id: state.accountId, limit: 24 },
      });
      if (Array.isArray(onChain)) {
        tokens = [...onChain.reverse(), ...tokens];
      }
    } catch (err) {
      console.warn('Could not load on-chain NFTs:', err);
    }
  }

  el.nftGallery.innerHTML = '';
  if (tokens.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'gallery-empty';
    empty.textContent = 'No NFTs minted yet for this account.';
    el.nftGallery.appendChild(empty);
    return;
  }

  for (const token of tokens) {
    const card = document.createElement('article');
    card.className = 'gallery-item';

    const img = document.createElement('img');
    img.src = token.metadata?.media || './assets/new-logo.png';
    img.alt = token.metadata?.title || token.token_id;
    card.appendChild(img);

    const body = document.createElement('div');
    body.className = 'gallery-item-body';

    const title = document.createElement('strong');
    title.textContent = `${token.metadata?.title || 'Untitled'} (${token.token_id})`;
    body.appendChild(title);

    if (token.metadata?.description) {
      const desc = document.createElement('small');
      desc.textContent = token.metadata.description;
      body.appendChild(desc);
    }

    if (token.metadata?.extra) {
      try {
        const prov = JSON.parse(token.metadata.extra);
        if (prov.prompt) {
          const provEl = document.createElement('small');
          provEl.textContent = `Prompt: "${prov.prompt}"`;
          body.appendChild(provEl);
        }
      } catch {
        // ignore non-JSON extra
      }
    }

    card.appendChild(body);
    el.nftGallery.appendChild(card);
  }
}
