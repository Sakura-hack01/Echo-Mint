import {
  NearBindgen,
  near,
  call,
  view,
  initialize,
  LookupMap,
  UnorderedMap,
  UnorderedSet,
  assert,
} from "near-sdk-js";

export interface NFTContractMetadata {
  spec: string;
  name: string;
  symbol: string;
  icon?: string | null;
  base_uri?: string | null;
  reference?: string | null;
  reference_hash?: string | null;
}

export interface TokenMetadata {
  title?: string | null;
  description?: string | null;
  media?: string | null;
  media_hash?: string | null;
  copies?: number | null;
  issued_at?: string | null;
  expires_at?: string | null;
  starts_at?: string | null;
  updated_at?: string | null;
  extra?: string | null;
  reference?: string | null;
  reference_hash?: string | null;
}

export interface Token {
  token_id: string;
  owner_id: string;
  metadata: TokenMetadata;
  approved_account_ids: Record<string, number>;
}

const DEFAULT_CONTRACT_METADATA: NFTContractMetadata = {
  spec: "nft-1.0.0",
  name: "EchoMint",
  symbol: "ECHOMINT",
  icon: null,
  base_uri: null,
  reference: null,
  reference_hash: null,
};

@NearBindgen({})
export class EchoMintContract {
  owner_id: string = "";
  contract_metadata: NFTContractMetadata = DEFAULT_CONTRACT_METADATA;
  tokens_by_id = new LookupMap<Token>("t");
  tokens_per_owner = new LookupMap<UnorderedSet<string>>("o");
  all_token_ids = new UnorderedSet<string>("a");
  next_token_seq: number = 1;

  @initialize({})
  init({
    owner_id,
    metadata,
  }: {
    owner_id?: string;
    metadata?: Partial<NFTContractMetadata>;
  }) {
    this.owner_id = owner_id || near.predecessorAccountId();
    this.contract_metadata = {
      ...DEFAULT_CONTRACT_METADATA,
      ...(metadata || {}),
    };
  }

  @view({})
  nft_metadata(): NFTContractMetadata {
    return this.contract_metadata;
  }

  @view({})
  nft_total_supply(): string {
    return this.all_token_ids.length.toString();
  }

  @view({})
  nft_supply_for_owner({ account_id }: { account_id: string }): string {
    const ownerTokens = this.tokens_per_owner.get(account_id);
    if (!ownerTokens) {
      return "0";
    }
    return ownerTokens.length.toString();
  }

  @view({})
  nft_token({ token_id }: { token_id: string }): Token | null {
    return this.tokens_by_id.get(token_id) || null;
  }

  @view({})
  nft_tokens({
    from_index = "0",
    limit = 50,
  }: {
    from_index?: string;
    limit?: number;
  }): Token[] {
    const start = Math.max(0, Number(from_index) || 0);
    const maxItems = Math.min(Math.max(1, Number(limit) || 50), 100);
    const ids = this.all_token_ids.toArray();
    const slice = ids.slice(start, start + maxItems);
    const result: Token[] = [];
    for (const id of slice) {
      const token = this.tokens_by_id.get(id);
      if (token) {
        result.push(token);
      }
    }
    return result;
  }

  @view({})
  nft_tokens_for_owner({
    account_id,
    from_index = "0",
    limit = 50,
  }: {
    account_id: string;
    from_index?: string;
    limit?: number;
  }): Token[] {
    const ownerTokens = this.tokens_per_owner.get(account_id);
    if (!ownerTokens) {
      return [];
    }
    const start = Math.max(0, Number(from_index) || 0);
    const maxItems = Math.min(Math.max(1, Number(limit) || 50), 100);
    const ids = ownerTokens.toArray();
    const slice = ids.slice(start, start + maxItems);
    const result: Token[] = [];
    for (const id of slice) {
      const token = this.tokens_by_id.get(id);
      if (token) {
        result.push(token);
      }
    }
    return result;
  }

  /**
   * Mint a new NFT on NEAR with optional AI prompt provenance stored inside
   * `token_metadata.extra` and/or `reference` (IPFS metadata JSON CID).
   */
  @call({ payableFunction: true })
  nft_mint({
    token_id,
    receiver_id,
    token_metadata,
  }: {
    token_id?: string;
    receiver_id?: string;
    token_metadata: TokenMetadata;
  }): Token {
    const initialStorage = near.storageUsage();
    const minter = near.predecessorAccountId();
    const owner = receiver_id || minter;

    const resolvedTokenId = token_id && token_id.trim().length > 0
      ? token_id.trim()
      : `echo-${this.next_token_seq}`;

    assert(
      !this.tokens_by_id.containsKey(resolvedTokenId),
      `Token ID "${resolvedTokenId}" already exists`
    );
    assert(
      Boolean(token_metadata && (token_metadata.title || token_metadata.media)),
      "token_metadata must include at least a title or media URL"
    );

    const metadata: TokenMetadata = {
      title: token_metadata.title ?? resolvedTokenId,
      description: token_metadata.description ?? null,
      media: token_metadata.media ?? null,
      media_hash: token_metadata.media_hash ?? null,
      copies: token_metadata.copies ?? 1,
      issued_at: token_metadata.issued_at ?? near.blockTimestamp().toString(),
      expires_at: token_metadata.expires_at ?? null,
      starts_at: token_metadata.starts_at ?? null,
      updated_at: token_metadata.updated_at ?? null,
      extra: token_metadata.extra ?? null,
      reference: token_metadata.reference ?? null,
      reference_hash: token_metadata.reference_hash ?? null,
    };

    const token: Token = {
      token_id: resolvedTokenId,
      owner_id: owner,
      metadata,
      approved_account_ids: {},
    };

    this.tokens_by_id.set(resolvedTokenId, token);
    this.all_token_ids.set(resolvedTokenId);
    this.addTokenToOwner(owner, resolvedTokenId);

    if (!token_id || token_id.trim().length === 0) {
      this.next_token_seq += 1;
    }

    near.log(
      `EVENT_JSON:${JSON.stringify({
        standard: "nep171",
        version: "1.0.0",
        event: "nft_mint",
        data: [{ owner_id: owner, token_ids: [resolvedTokenId] }],
      })}`
    );

    const storageUsed = near.storageUsage() - initialStorage;
    this.refundExcessStorage(storageUsed);

    return token;
  }

  @call({ payableFunction: true })
  nft_transfer({
    receiver_id,
    token_id,
    approval_id,
    memo,
  }: {
    receiver_id: string;
    token_id: string;
    approval_id?: number;
    memo?: string;
  }) {
    const attachedDeposit = near.attachedDeposit();
    assert(
      attachedDeposit === BigInt(1),
      "Requires attached deposit of exactly 1 yoctoNEAR"
    );

    const sender = near.predecessorAccountId();
    const token = this.tokens_by_id.get(token_id);
    assert(token !== null, `Token "${token_id}" not found`);

    const isOwner = token.owner_id === sender;
    const approvedId = token.approved_account_ids[sender];
    const isApproved =
      approvedId !== undefined &&
      (approval_id === undefined || approvedId === approval_id);
    assert(isOwner || isApproved, "Unauthorized transfer");
    assert(
      receiver_id !== token.owner_id,
      "Receiver must differ from current owner"
    );

    const previousOwner = token.owner_id;
    this.removeTokenFromOwner(previousOwner, token_id);
    this.addTokenToOwner(receiver_id, token_id);

    token.owner_id = receiver_id;
    token.approved_account_ids = {};
    this.tokens_by_id.set(token_id, token);

    near.log(
      `EVENT_JSON:${JSON.stringify({
        standard: "nep171",
        version: "1.0.0",
        event: "nft_transfer",
        data: [
          {
            authorized_id: isOwner ? undefined : sender,
            old_owner_id: previousOwner,
            new_owner_id: receiver_id,
            token_ids: [token_id],
            memo: memo || undefined,
          },
        ],
      })}`
    );
  }

  private addTokenToOwner(accountId: string, tokenId: string) {
    let ownerTokens = this.tokens_per_owner.get(accountId);
    if (!ownerTokens) {
      ownerTokens = new UnorderedSet<string>(`o:${accountId}`);
    }
    ownerTokens.set(tokenId);
    this.tokens_per_owner.set(accountId, ownerTokens);
  }

  private removeTokenFromOwner(accountId: string, tokenId: string) {
    const ownerTokens = this.tokens_per_owner.get(accountId);
    assert(ownerTokens !== null, "Owner token set missing");
    ownerTokens.remove(tokenId);
    this.tokens_per_owner.set(accountId, ownerTokens);
  }

  private refundExcessStorage(storageUsed: bigint) {
    const attached = near.attachedDeposit();
    if (attached === BigInt(0)) {
      return;
    }
    const requiredCost =
      storageUsed > BigInt(0)
        ? storageUsed * near.storageByteCost()
        : BigInt(0);
    assert(
      attached >= requiredCost,
      `Insufficient deposit for storage: attached ${attached}, required ${requiredCost}`
    );
    const refund = attached - requiredCost;
    if (refund > BigInt(1)) {
      const promise = near.promiseBatchCreate(near.predecessorAccountId());
      near.promiseBatchActionTransfer(promise, refund);
    }
  }
}
