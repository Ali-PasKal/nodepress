import { Button } from '@nexora/ui';
import { Link } from 'react-router';
import { PageHeader } from '../components/page-header';

export function NotFoundPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Page not found"
        description="The page you requested does not exist in the dashboard."
      />
      <div>
        <Button asChild variant="outline">
          <Link to="/system/status">Go to system status</Link>
        </Button>
      </div>
    </div>
  );
}
