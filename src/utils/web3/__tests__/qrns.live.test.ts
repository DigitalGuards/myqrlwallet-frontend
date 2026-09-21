import { normalizeQrlAddress } from '@/utils/web3/address';
import {
  createQrnsHttpProvider,
  resolveQrnsRecipient,
  type QrnsNetworkConfig,
} from '@/utils/web3/qrns';

const describeLive = process.env['QRNS_LIVE'] === '1' ? describe : describe.skip;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live QRNS test`);
  return value;
}

describeLive('live native QRVM64 QRNS composition', () => {
  it('resolves a configured .qrl name through the wallet implementation', async () => {
    const config: QrnsNetworkConfig = {
      blockchain: 'TEST_NET',
      networkName: 'Local QRL 2.0 Kurtosis',
      rpcUrl: requiredEnvironment('QRNS_LIVE_RPC_URL'),
      expectedChainId: requiredEnvironment('QRNS_LIVE_CHAIN_ID'),
      registry: requiredEnvironment('QRNS_LIVE_REGISTRY'),
    };
    const name = requiredEnvironment('QRNS_LIVE_NAME');

    const result = await resolveQrnsRecipient(
      name,
      config,
      createQrnsHttpProvider(config.rpcUrl),
    );

    expect(result.normalizedName).toBe(name.toLowerCase());
    expect(result.address).toHaveLength(129);
    expect(normalizeQrlAddress(result.address ?? '')).toBe(result.address);
  });
});
