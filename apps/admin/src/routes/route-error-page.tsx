import { Alert, AlertDescription, AlertTitle, Button } from '@nexora/ui';
import { CircleX } from 'lucide-react';
import { isRouteErrorResponse, useRouteError } from 'react-router';

/** Last-resort boundary for errors thrown while rendering a route. Never shows stack traces. */
export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${String(error.status)} ${error.statusText}`
    : 'An unexpected error occurred while displaying this page.';
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <Alert tone="danger">
        <CircleX aria-hidden="true" />
        <div>
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </div>
      </Alert>
      <div>
        <Button
          variant="outline"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload the page
        </Button>
      </div>
    </main>
  );
}
