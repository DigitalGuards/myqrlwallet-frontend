/**
 * Guards the QRL transaction-polling config: that it stays sane for a ~60s block
 * time, that the installed web3 actually honors it (catches a config-API change
 * on a future web3 upgrade), and that it genuinely improves on the web3 defaults.
 */
import Web3 from '@theqrl/web3';
import { QRL_TX_POLLING_CONFIG } from '../txPolling';

const PROVIDER = () => new Web3.providers.HttpProvider('http://localhost:8545');

describe('QRL_TX_POLLING_CONFIG', () => {
  it('polls slowly enough for a ~60s block time and waits on a single confirmation', () => {
    expect(QRL_TX_POLLING_CONFIG.transactionPollingInterval).toBeGreaterThanOrEqual(5000);
    expect(QRL_TX_POLLING_CONFIG.transactionConfirmationBlocks).toBeLessThanOrEqual(2);
    expect(QRL_TX_POLLING_CONFIG.transactionPollingTimeout).toBeGreaterThanOrEqual(QRL_TX_POLLING_CONFIG.transactionPollingInterval);
  });

  it('is actually applied by the installed @theqrl/web3 (guards against a config-API change on upgrade)', () => {
    const { qrl } = new Web3({ provider: PROVIDER(), config: QRL_TX_POLLING_CONFIG });
    expect(qrl.transactionPollingInterval).toBe(QRL_TX_POLLING_CONFIG.transactionPollingInterval);
    expect(qrl.transactionConfirmationBlocks).toBe(QRL_TX_POLLING_CONFIG.transactionConfirmationBlocks);
    expect(qrl.transactionPollingTimeout).toBe(QRL_TX_POLLING_CONFIG.transactionPollingTimeout);
  });

  it('improves drastically over the web3 4.x defaults it replaces', () => {
    // Documents the defaults that caused ~100 RPC calls/tx; if a web3 upgrade
    // changes these, this test flags that our override math needs review.
    const { qrl } = new Web3(PROVIDER());
    expect(qrl.transactionPollingInterval).toBe(1000);
    expect(qrl.transactionConfirmationBlocks).toBe(24);
    expect(QRL_TX_POLLING_CONFIG.transactionPollingInterval).toBeGreaterThan(qrl.transactionPollingInterval);
    expect(QRL_TX_POLLING_CONFIG.transactionConfirmationBlocks).toBeLessThan(qrl.transactionConfirmationBlocks);
  });
});
