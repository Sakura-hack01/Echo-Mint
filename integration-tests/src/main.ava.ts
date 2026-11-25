import { Worker, NearAccount, NEAR } from 'near-workspaces';
import anyTest, { TestFn } from 'ava';

const test = anyTest as TestFn<{
  worker: Worker;
  accounts: Record<string, NearAccount>;
}>;

test.beforeEach(async (t) => {
  const worker = await Worker.init();
  const root = worker.rootAccount;
  const contract = await root.createSubAccount('echomint');
  const alice = await root.createSubAccount('alice');

  await contract.deploy(process.argv[2]);
  await contract.call(contract, 'init', { owner_id: root.accountId });

  t.context.worker = worker;
  t.context.accounts = { root, contract, alice };
});

test.afterEach(async (t) => {
  await t.context.worker.tearDown().catch((error) => {
    console.log('Failed to stop the Sandbox:', error);
  });
});

test('returns contract metadata', async (t) => {
  const { contract } = t.context.accounts;
  const metadata: { spec: string; name: string; symbol: string } =
    await contract.view('nft_metadata', {});
  t.is(metadata.spec, 'nft-1.0.0');
  t.is(metadata.name, 'EchoMint');
  t.is(metadata.symbol, 'ECHOMINT');
});

test('mints an NFT with AI prompt provenance and lists it for owner', async (t) => {
  const { root, contract, alice } = t.context.accounts;

  const provenance = JSON.stringify({
    prompt: 'Cyberpunk lotus floating over NEAR skyline',
    model: 'stable-diffusion-xl',
    generator: 'EchoMint AI Studio',
  });

  const minted: any = await root.call(
    contract,
    'nft_mint',
    {
      receiver_id: alice.accountId,
      token_metadata: {
        title: 'Cyber Lotus #1',
        description: 'Minted conversationally via EchoMint',
        media: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        extra: provenance,
      },
    },
    { attachedDeposit: NEAR.parse('0.05 N').toString() }
  );

  t.is(minted.token_id, 'echo-1');
  t.is(minted.owner_id, alice.accountId);
  t.is(minted.metadata.title, 'Cyber Lotus #1');
  t.is(minted.metadata.extra, provenance);

  const owned: any[] = await contract.view('nft_tokens_for_owner', {
    account_id: alice.accountId,
  });
  t.is(owned.length, 1);
  t.is(owned[0].token_id, 'echo-1');

  const totalSupply: string = await contract.view('nft_total_supply', {});
  t.is(totalSupply, '1');
});

test('transfers an NFT to a new owner', async (t) => {
  const { root, contract, alice } = t.context.accounts;

  await alice.call(
    contract,
    'nft_mint',
    {
      token_id: 'custom-1',
      token_metadata: {
        title: 'Transfer Test NFT',
        media: 'https://example.com/art.png',
      },
    },
    { attachedDeposit: NEAR.parse('0.05 N').toString() }
  );

  await alice.call(
    contract,
    'nft_transfer',
    {
      receiver_id: root.accountId,
      token_id: 'custom-1',
      memo: 'Gift via EchoMint',
    },
    { attachedDeposit: '1' }
  );

  const token: any = await contract.view('nft_token', { token_id: 'custom-1' });
  t.is(token.owner_id, root.accountId);
});
