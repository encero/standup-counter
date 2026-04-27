export function TeamNotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
      <div className="text-center space-y-4 max-w-md">
        <h1 className="text-4xl font-bold">🔒</h1>
        <h2 className="text-2xl font-semibold">Team Not Found</h2>
        <p className="text-muted-foreground">
          This standup timer requires a valid team URL.
          <br />
          Please check with your team administrator for the correct link.
        </p>
        <p className="text-sm text-muted-foreground/60">
          URLs should look like: <code className="bg-muted px-2 py-1 rounded">yourdomain.com/abc123</code>
        </p>
      </div>
    </div>
  );
}
