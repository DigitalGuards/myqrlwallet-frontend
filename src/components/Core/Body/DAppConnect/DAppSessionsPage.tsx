/**
 * Standalone /dapp-sessions route: where web fragment-link handoffs land and
 * the consent modal navigates after a successful connect. Settings embeds
 * the same list in its own card instead.
 */

import { Card } from '@/components/UI/Card';
import DAppSessionsList from './DAppSessionsList';

const DAppSessionsPage = () => (
  <div className="page-enter mx-auto w-full max-w-3xl px-4 py-8">
    <Card >
      <DAppSessionsList />
    </Card>
  </div>
);

export default DAppSessionsPage;
